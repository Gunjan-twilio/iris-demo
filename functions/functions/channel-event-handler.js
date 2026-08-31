// Conversation attribute used to record that the agent has left the interaction, i.e. that the
// interaction channel went inactive.
//
// We deliberately do NOT use the conversation's own state to detect a resume. Conversations
// automatically transitions a conversation from inactive back to active as soon as a new message is
// added, so by the time this webhook fires the conversation may already read as "active" and the
// inactive -> active transition is lost. Whether we win that race is timing dependent, which would
// make the re-invite below fire intermittently.
//
// This flag is what lets us tell the two kinds of "active" event apart:
//   - The interaction going active for the FIRST time: no flag is set. The interaction already
//     created a task when it was created, so an agent is on the way and there is nothing to do.
//   - Any SUBSEQUENT transition to active: the flag is set, meaning the agent previously left and
//     the customer has come back, so we need to re-invite an agent to the existing interaction.
//
// The flag is set once and never cleared. Its only job is to catch that initial activation, which is
// the one case that is not a resume; after an agent has left once, every later activation needs a
// re-invite, so there is nothing to reset.
//
// Alternatives considered for detecting that an agent needs re-inviting to a conversation the agent
// has left:
//   - Add a webhook at the point the leave occurs, so the leave itself tells us the interaction and
//     channel to re-invite into. This would require a custom leave rather than the built-in one.
//   - Subscribe to a Conversations event webhook and watch onConversationUpdated for the
//     inactive -> active transition. That event only identifies the conversation, not the
//     interaction or interaction channel, so it would require maintaining a cache of conversation
//     SID -> interaction SIDs to know where to send the invite.
//   - Attach a Conversations onMessageAdded webhook to the conversation when the agent leaves, and
//     remove it again once an agent has been re-invited. A burst of inbound messages can all land
//     before the webhook is removed, so each one fires and invites its own agent.
//
const LEFT_INTERACTION_ATTRIBUTE = "leftInteraction";

function parseConversationAttributes(rawAttributes, interactionSid) {
  try {
    const parsed = JSON.parse(rawAttributes || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch (error) {
    console.warn(
      `${interactionSid}: Conversation attributes are not valid JSON. Treating as empty.`,
    );
    return {};
  }
}

async function inviteAgentToInteraction(
  client,
  interactionSid,
  channelSid,
  mediaChannelType,
  workspaceSid,
  workflowSid,
  taskRouterAttributes,
) {
  const invite = await client.flexApi.v1
    .interaction(interactionSid)
    .channels(channelSid)
    .invites.create({
      routing: {
        properties: {
          workspace_sid: workspaceSid,
          workflow_sid: workflowSid,
          task_channel_unique_name: mediaChannelType,
          attributes: taskRouterAttributes,
        },
      },
    });

  return {
    inviteSid: invite.sid,
    taskSid: invite.routing.properties.sid,
  };
}

exports.handler = async function (context, event, callback) {
  const twilioClient = context.getTwilioClient();
  const {
    MediaChannelSid,
    MediaChannelType,
    ChannelStatus: InteractionChannelStatus,
    InteractionSid,
    ChannelSid: InteractionChannelSid,
    EventType,
  } = event;

  if (EventType !== "onChannelStatusUpdated") {
    console.log(`${InteractionSid}: Ignoring event type ${EventType}.`);
    return callback(null, {});
  }

  try {
    if (
      !MediaChannelSid ||
      !MediaChannelType ||
      !InteractionChannelStatus ||
      !InteractionSid ||
      !InteractionChannelSid
    ) {
      console.log(
        `${InteractionSid}: Missing required parameters in the event payload:`,
        event,
      );
      return callback(null, {});
    }

    if (MediaChannelType === "voice") {
      // voice does technically generate interaction state webhooks but no concept of leave and resume.
      console.log(`${InteractionSid}: Ignoring voice channel.`);
      return callback(null, {});
    }

    switch (InteractionChannelStatus) {
      case "inactive": {
        // The agent has left the interaction. Park the conversation and record that any later
        // transition back to active is a resume rather than a first activation.
        const conversation = await twilioClient.conversations.v1
          .conversations(MediaChannelSid)
          .fetch();
        const attributes = parseConversationAttributes(
          conversation.attributes,
          InteractionSid,
        );
        const agentHasLeft = attributes[LEFT_INTERACTION_ATTRIBUTE] === true;

        const updates = {};
        if (conversation.state !== "inactive") {
          updates.state = "inactive";
        }
        if (!agentHasLeft) {
          updates.attributes = JSON.stringify({
            ...attributes,
            [LEFT_INTERACTION_ATTRIBUTE]: true,
          });
        }

        if (Object.keys(updates).length === 0) {
          console.log(
            `${InteractionSid}: Conversation ${MediaChannelSid} already inactive with ${LEFT_INTERACTION_ATTRIBUTE}=true, so a later activation is already treated as a resume rather than a first activation. No action needed.`,
          );
          return callback(null, {});
        }

        const updatedConversation = await twilioClient.conversations.v1
          .conversations(MediaChannelSid)
          .update(updates);
        console.log(
          `${InteractionSid}: Parked conversation ${MediaChannelSid}; state=${updatedConversation.state}, ${LEFT_INTERACTION_ATTRIBUTE}=true.`,
        );
        return callback(null, {});
      }

      case "active": {
        // We only need the attributes here. The conversation state needs no counterpart to the write
        // above: a channel can only reach active through Flex's own transition on new message
        // activity, and adding that message has already activated the conversation for us.
        const conversation = await twilioClient.conversations.v1
          .conversations(MediaChannelSid)
          .fetch();
        const attributes = parseConversationAttributes(
          conversation.attributes,
          InteractionSid,
        );
        const agentHasLeft = attributes[LEFT_INTERACTION_ATTRIBUTE] === true;

        if (!agentHasLeft) {
          // First activation of this interaction: the task created alongside the interaction is
          // already routing an agent here, so no re-invite is needed.
          console.log(
            `${InteractionSid}: Interaction active for the first time. No re-invite needed.`,
          );
          return callback(null, {});
        }

        // at this point you would fetch additional taskrouter attributes based on the conversation SID.
        // const taskRouterAttributes = await fetchCaseAndRoutingAndEmailAddressForConversation(MediaChannelSid);
        const taskRouterAttributes = {
          name: "customer A",
          caseId: "1234",
          routing: "test-routing",
        };

        // Invite agent to existing interaction
        const { taskSid } = await inviteAgentToInteraction(
          twilioClient,
          InteractionSid,
          InteractionChannelSid,
          MediaChannelType,
          context.WORKSPACE_SID,
          context.WORKFLOW_SID,
          taskRouterAttributes,
        );

        console.log(
          `${InteractionSid}: Agent re-invited to resumed interaction. Task SID: ${taskSid}`,
        );
        return callback(null, {});
      }

      default: {
        // Closed is the only other status, and closing a channel already closes the underlying
        // conversation, so there is nothing to sync and nothing to resume.
        console.log(
          `${InteractionSid}: Ignoring channel status ${InteractionChannelStatus}.`,
        );
        return callback(null, {});
      }
    }
  } catch (error) {
    console.error(
      `${InteractionSid}: Error processing interaction state webhook:`,
      error,
    );

    // Respond non-2xx so an unexpected failure surfaces in the Twilio debugger and can be alerted
    // on, rather than being recorded as a successful webhook delivery. The deliberate no-op paths
    // above still return 200 because there is nothing wrong to report.
    const response = new Twilio.Response();
    response.setStatusCode(500);
    response.appendHeader("Content-Type", "application/json");
    response.setBody({
      status: "error",
      message: "Error processing interaction state webhook.",
      error: error.message,
    });

    return callback(null, response);
  }
};