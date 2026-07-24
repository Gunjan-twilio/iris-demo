"""
Roll back the TEMP In-Reply-To interceptor from the Email Studio Flow.

Removes InterceptReply + CheckMatched widgets and restores Trigger's
incomingConversationMessage → SendConversationToAgent transition.

Also deletes the email_message_map Sync Map so no stale entries hang around.

Run once Twilio ships native In-Reply-To routing and the source-side removal
of the TEMP FIX code has been merged.

Usage:
  set -a; source functions/.env; set +a
  python3 scripts/revert-temp-intercept.py
"""
import json, os, urllib.request, urllib.parse, base64, sys

acct = os.environ["ACCOUNT_SID"]
auth = os.environ["AUTH_TOKEN"]
flow_sid = "FWaea27936c50fc408a2d248d781c6f956"  # Email Flow

basic = base64.b64encode(f"{acct}:{auth}".encode()).decode()

# --- Studio Flow revert ---
req = urllib.request.Request(
    f"https://studio.twilio.com/v2/Flows/{flow_sid}",
    headers={"Authorization": f"Basic {basic}"},
)
flow = json.loads(urllib.request.urlopen(req).read())
defn = flow["definition"]

# Restore Trigger transition
for state in defn["states"]:
    if state["name"] == "Trigger":
        for t in state["transitions"]:
            if t["event"] == "incomingConversationMessage":
                t["next"] = "SendConversationToAgent"

# Remove interceptor states
defn["states"] = [s for s in defn["states"] if s["name"] not in ("InterceptReply", "CheckMatched")]

# Restore original offset
for state in defn["states"]:
    if state["name"] == "SendConversationToAgent":
        state["properties"]["offset"] = {"x": 380, "y": 180}

payload = urllib.parse.urlencode({
    "Status": "published",
    "Definition": json.dumps(defn),
    "CommitMessage": "Remove TEMP In-Reply-To interceptor",
}).encode()

update_req = urllib.request.Request(
    f"https://studio.twilio.com/v2/Flows/{flow_sid}",
    data=payload,
    headers={
        "Authorization": f"Basic {basic}",
        "Content-Type": "application/x-www-form-urlencoded",
    },
    method="POST",
)
try:
    resp = json.loads(urllib.request.urlopen(update_req).read())
    print(f"studio flow reverted. revision={resp.get('revision')} status={resp.get('status')}")
except urllib.error.HTTPError as e:
    print(f"studio flow HTTP {e.code}: {e.read().decode()}", file=sys.stderr)
    sys.exit(1)

# --- Delete Sync Map ---
sync_service = os.environ.get("SYNC_SERVICE_SID", "default")
del_req = urllib.request.Request(
    f"https://sync.twilio.com/v1/Services/{sync_service}/Maps/email_message_map",
    headers={"Authorization": f"Basic {basic}"},
    method="DELETE",
)
try:
    urllib.request.urlopen(del_req)
    print("sync map email_message_map deleted")
except urllib.error.HTTPError as e:
    if e.code == 404:
        print("sync map email_message_map already gone")
    else:
        print(f"sync map delete HTTP {e.code}: {e.read().decode()}", file=sys.stderr)
