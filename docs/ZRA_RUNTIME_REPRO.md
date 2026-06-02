# zRA Runtime Reproduction

This is the shortest reproducible path for a second operator laptop and a second Raspberry Pi.

## Control Laptop

1. Clone `urdf-studio`.
2. Install dependencies and the Python environment.
3. Start the app:

```bash
cd /path/to/urdf-studio
npm install
npm run setup
npm run start
```

Important:

- `npm run start` brings up the local backend and frontend for the runtime/trust demo without extra auth setup.

## Raspberry Pi

1. Clone `zkp`.
2. Follow [`device-attestation/runbook.md`](/home/am/dev/zkp/device-attestation/runbook.md).
3. Start the periodic attestation publisher.

## Minimum Host-Specific Values

Only these values must change per deployment:

- `YOUR_URDF_STUDIO_HOST`
- `YOUR_PI_HOST`
- `robot_id` if you are not using `my_kiwi`

Everything else can use repo defaults for the demo path.
