# Place TLS material here for nginx (docker-compose.prod.yml mounts this dir):
#   fullchain.pem
#   privkey.pem
#
# Bootstrap self-signed (replace with Let's Encrypt in production):
#   openssl req -x509 -nodes -days 90 -newkey rsa:2048 \
#     -keyout privkey.pem -out fullchain.pem \
#     -subj "/CN=iot.ntoric.com"
