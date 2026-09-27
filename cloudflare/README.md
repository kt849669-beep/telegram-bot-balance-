# Cloudflare hosting boundary

Use Cloudflare Tunnel on the VPS to publish `http://127.0.0.1:8787` at an HTTPS hostname. Configure the same public origin in the Mini App and the Telegram menu. A named tunnel with a domain you control provides a persistent hostname; a Quick Tunnel is temporary.

The Workers & Pages creation page is not a virtual server. Uploading this UI to Pages alone does not run the Node bot, account storage, OCR or the Mini App API. This package therefore does not contain a misleading static-only deployment.

Cloudflare Containers is a different product with hosting charges and separate persistence requirements. It has not been provisioned or configured by this package.

Official references:

- [Workers execution model](https://developers.cloudflare.com/workers/reference/how-workers-works/)
- [Workers virtual filesystem](https://developers.cloudflare.com/workers/runtime-apis/nodejs/fs/)
- [Create a named Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel/)
