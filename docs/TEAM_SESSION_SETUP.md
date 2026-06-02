# Team Session Setup

Use this when one laptop is the URDF Studio server and teammates edit from the same trusted Wi-Fi or wired LAN.

## Start The Server Laptop

```bash
npm run team
```

The launcher will:

- pick a LAN address automatically
- expose the frontend and backend on that LAN address
- start the Rust teleop sidecar
- keep the normal remote-exposure confirmation gate
- print a Team URL you can open in the browser

If the launcher picks the wrong address, pass the one printed by your OS Wi-Fi settings:

```bash
npm run team -- --team-host 192.168.1.40
```

For scripts or demos where prompts are not possible:

```bash
npm run team -- --ack-remote-exposure
```

## Invite Editors

1. Open the Team URL on the server laptop.
2. Use Share in the top bar.
3. Send the collaboration link to the people who should edit.
4. Use Share again to lock editing or rotate the editor link.

The room token lives in the URL fragment after `#`, so normal HTTP requests do not send the room token as a query string.

## Access Model

- Creating a room stays operator-gated on the server laptop.
- Joining or editing an existing room uses the collaboration room token.
- Remote operator/backend routes stay disabled unless `URDF_SIMULATOR_API_TOKEN` is configured.
- Native QUIC robot/native-client teleop stays mTLS-gated unless certificates and a client CA are configured.

## Network Notes

Use `npm run team` only on a network you intentionally trust. For a hackathon or defense demo with several teams on the same Wi-Fi, each team should run its own server laptop and share only its own collaboration link.

If a teammate cannot connect:

- confirm they are on the same Wi-Fi/LAN
- check that the Team URL uses the server laptop LAN IP, not `localhost`
- retry with `npm run team -- --team-host <server-laptop-ip>`
- check local firewall prompts for Node, Python, and the Rust sidecar
