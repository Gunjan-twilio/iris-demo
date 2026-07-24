"""
Apply the TEMP In-Reply-To interceptor widgets to the Email Studio Flow.

Inserts `InterceptReply` (Run Function) and `CheckMatched` (Split Based On)
between the Trigger's `incomingConversationMessage` event and the
`SendConversationToAgent` (Send-to-Flex) widget. On match=true the flow ends
without creating a task; on no-match or error it falls through to the normal
Send-to-Flex path.

Idempotent-ish: if the two widgets already exist, they're left in place.

Prereqs:
  - Email Flow SID exported below (find via
    `curl -u $ACCOUNT_SID:$AUTH_TOKEN https://studio.twilio.com/v2/Flows`)
  - Serverless service/environment/function SIDs for /intercept-reply (find via
    `twilio serverless:list-functions`).

Usage:
  set -a; source functions/.env; set +a
  python3 scripts/apply-temp-intercept.py

The symmetric teardown lives in `revert-temp-intercept.py`.
"""
import json, os, urllib.request, urllib.parse, base64, sys

acct = os.environ["ACCOUNT_SID"]
auth = os.environ["AUTH_TOKEN"]

# TODO: adjust these three for your Twilio account
FLOW_SID = os.environ.get("EMAIL_STUDIO_FLOW_SID", "FWaea27936c50fc408a2d248d781c6f956")
SERVERLESS_SERVICE_SID = os.environ.get("SERVERLESS_SERVICE_SID", "ZSf434ca0619f4c859390171e3843523d8")
SERVERLESS_ENV_SID = os.environ.get("SERVERLESS_ENV_SID", "ZE586d0e4c6a59861b9ceefa6840361e46")
INTERCEPT_FUNCTION_SID = os.environ.get("INTERCEPT_FUNCTION_SID", "ZH2b9f7866709a12573f829d89ef81639a")

# URL used by the Run Function widget's `url` property — must match your deployed domain.
INTERCEPT_URL = os.environ.get("INTERCEPT_URL", "https://iris-demo-2775-dev.twil.io/intercept-reply")

basic = base64.b64encode(f"{acct}:{auth}".encode()).decode()

# Fetch current flow definition
req = urllib.request.Request(
    f"https://studio.twilio.com/v2/Flows/{FLOW_SID}",
    headers={"Authorization": f"Basic {basic}"},
)
flow = json.loads(urllib.request.urlopen(req).read())
defn = flow["definition"]

existing_names = {s["name"] for s in defn["states"]}
if "InterceptReply" in existing_names and "CheckMatched" in existing_names:
    print("interceptor widgets already present — nothing to do")
    sys.exit(0)

# Redirect Trigger's incomingConversationMessage into the interceptor
for state in defn["states"]:
    if state["name"] == "Trigger":
        for t in state["transitions"]:
            if t["event"] == "incomingConversationMessage":
                t["next"] = "InterceptReply"

# InterceptReply — Run Function widget
if "InterceptReply" not in existing_names:
    defn["states"].append({
        "name": "InterceptReply",
        "type": "run-function",
        "properties": {
            "service_sid": SERVERLESS_SERVICE_SID,
            "environment_sid": SERVERLESS_ENV_SID,
            "function_sid": INTERCEPT_FUNCTION_SID,
            "parameters": [
                {"key": "conversationSid", "value": "{{trigger.conversation.ConversationSid}}"}
            ],
            "url": INTERCEPT_URL,
            "offset": {"x": 380, "y": 80},
        },
        "transitions": [
            {"event": "success", "next": "CheckMatched"},
            # Fail-open: any function error falls through to normal task creation.
            {"event": "fail", "next": "SendConversationToAgent"},
        ],
    })

# CheckMatched — Split Based On widget
if "CheckMatched" not in existing_names:
    defn["states"].append({
        "name": "CheckMatched",
        "type": "split-based-on",
        "properties": {
            "input": "{{widgets.InterceptReply.parsed.matched}}",
            "offset": {"x": 380, "y": 260},
        },
        "transitions": [
            # matched=true → flow ends (no transition) → no Flex task created
            {
                "event": "match",
                "conditions": [
                    {
                        "friendly_name": "If matched=true",
                        "arguments": ["{{widgets.InterceptReply.parsed.matched}}"],
                        "type": "equal_to",
                        "value": "true",
                    }
                ],
            },
            # Anything else → normal task creation
            {"event": "noMatch", "next": "SendConversationToAgent"},
        ],
    })

# Nudge the Send-to-Flex box down so the diagram remains legible
for state in defn["states"]:
    if state["name"] == "SendConversationToAgent":
        state["properties"]["offset"] = {"x": 380, "y": 460}

payload = urllib.parse.urlencode({
    "Status": "published",
    "Definition": json.dumps(defn),
    "CommitMessage": "TEMP: add In-Reply-To interceptor before Send-to-Flex",
}).encode()

update_req = urllib.request.Request(
    f"https://studio.twilio.com/v2/Flows/{FLOW_SID}",
    data=payload,
    headers={
        "Authorization": f"Basic {basic}",
        "Content-Type": "application/x-www-form-urlencoded",
    },
    method="POST",
)
try:
    resp = json.loads(urllib.request.urlopen(update_req).read())
    print(f"studio flow updated. revision={resp.get('revision')} status={resp.get('status')}")
except urllib.error.HTTPError as e:
    print(f"studio flow HTTP {e.code}: {e.read().decode()}", file=sys.stderr)
    sys.exit(1)
