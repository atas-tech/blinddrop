#!/bin/sh
set -eu

: "${REDIS_PASSWORD:?REDIS_PASSWORD must be set}"

# Keep the ACL file inside the container so the password is not committed to
# the repository or exposed through a bind-mounted host file.
umask 077
printf '%s\n' \
  'user default off' \
  "user blinddrop on >${REDIS_PASSWORD} ~secret:* ~blinddrop:ratelimit:* +auth +ping +quit +hset +hgetall +hget +del +setex +get +evalsha +eval +expire +type +incr +pexpire +pttl" \
  > /tmp/blinddrop-users.acl

exec redis-server /usr/local/etc/redis/redis.conf \
  --aclfile /tmp/blinddrop-users.acl \
  --requirepass "${REDIS_PASSWORD}"
