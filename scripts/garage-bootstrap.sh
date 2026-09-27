#!/usr/bin/env bash
# Create the buckets GenieChat needs and grant the application key access.
#
# Idempotent: `garage bucket create` fails on an existing bucket, which is the
# expected case on every run after the first, so the create tolerates failure
# and the run ends by listing the buckets and verifying every grant landed.
#
# Run by the `garage-bootstrap` compose service, or by hand wherever the
# `garage` binary is:
#   docker compose exec garage /garage bucket list
set -uo pipefail

BUCKETS="chat-documents chat-images reports agent-documents generated-images"

# The key `garage server --default-access-key` imports is named "default access
# key" (`garage key list` shows it), and `garage bucket allow --key` matches a
# key by that display name or by its id -- not by any name of our choosing. The
# grant below fails with NoSuchAccessKey for anything else, and the loop
# swallows that, which would leave four buckets that no key can reach. Hence
# the check up front.
KEY_NAME="${GARAGE_KEY_NAME:-default access key}"

echo "Waiting for Garage..."
until /garage status >/dev/null 2>&1; do
  sleep 2
done

if ! /garage key info "$KEY_NAME" >/dev/null 2>&1; then
  echo "ERROR: no access key matching '$KEY_NAME'." >&2
  echo "       The key for GARAGE_DEFAULT_ACCESS_KEY is named 'default access key'." >&2
  exit 1
fi

for bucket in $BUCKETS; do
  /garage bucket create "$bucket" 2>/dev/null || true
  /garage bucket allow --read --write --owner "$bucket" --key "$KEY_NAME" 2>/dev/null || true
done

echo "Buckets now present:"
/garage bucket list

# Verify the grants, not just the buckets. `bucket list` above looks identical
# whether every `allow` in the loop succeeded or every one of them failed, and
# `key info` alone exits 0 either way -- it only reports what it finds, so a key
# with no reachable bucket reads as success. Counting the grants is what turns a
# partially-granted key into a failure instead of a plausible-looking log. This
# is deliberately the script's last command: with no `set -e`, a check placed
# earlier would still be masked by `bucket list`'s zero exit status.
granted=$(/garage key info "$KEY_NAME" | grep -c '^RWO')
expected=$(echo "$BUCKETS" | wc -w)
if [ "$granted" -ne "$expected" ]; then
  echo "ERROR: '$KEY_NAME' has $granted of $expected bucket grants." >&2
  exit 1
fi
echo "Verified: '$KEY_NAME' has read/write/owner on all $expected buckets."
