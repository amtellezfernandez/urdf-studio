# Team Session Setup

Use this when one laptop is the URDF Studio server and teammates join from the same trusted Wi-Fi, wired LAN, or Tailnet.

## Start The Server Laptop

```bash
npm run team
```

The launcher will:

- pick a network address automatically
- expose the Studio app for the team session
- keep internal services local to the server laptop
- print a Team URL you can open in the browser

If the launcher picks the wrong address, pass the one printed by your OS network settings:

```bash
npm run team -- --team-host 192.168.1.40
```

For scripts or demos where prompts are not possible:

```bash
npm run team -- --ack-remote-exposure
```

## Invite Editors

1. Open the Team URL on the server laptop.
2. Use `Share` in the top bar.
3. Send the generated collaboration link to the people who should join.
4. Use `Share` again to pause sharing, reset links, or change access.

The room token lives in the URL fragment after `#`, so normal HTTP requests do not send it as a query string.

## Access Model

- Local start is private to the server laptop.
- Team mode is for intentional same-network sharing.
- Guests should join through the collaboration link from `Share`, not by guessing URLs.
- Sharing can be paused or reset from the server laptop.

## Network Notes

Use `npm run team` only on a network you intentionally trust. For a hackathon or defense demo with several teams on the same Wi-Fi, each team should run its own server laptop and share only its own collaboration link.

If a teammate cannot connect:

- confirm they are on the same Wi-Fi/LAN/Tailnet
- check that the Team URL uses the server laptop network address, not `localhost`
- retry with `npm run team -- --team-host <server-laptop-ip>`
- check local firewall prompts for Node
