# Teleoperation Mode

The teleoperation mode allows you to control robot joints through external data inputs. This mode supports multiple input methods including manual updates, WebSocket connections, and HTTP polling.

## Getting Started

1. Open URDF Studio and load your robot URDF file
2. Click on the "Utils" dropdown in the viewer
3. Select "Teleoperation" mode

## Input Methods

### 1. Manual Control (Browser Console)

When teleoperation mode is active, a global API is exposed on `window.teleoperation`.

```javascript
// Send joint positions
window.teleoperation.updateData({
  jointPositions: {
    joint1: 0.5,
    joint2: -0.3,
    shoulder_pan_joint: 1.57,
  }
});

// Send end-effector position (for future IK support)
window.teleoperation.updateData({
  endEffectorPosition: {
    x: 0.5,
    y: 0.3,
    z: 0.8
  },
  endEffectorOrientation: {
    x: 0,
    y: 0,
    z: 0,
    w: 1
  }
});

// Check connection status
console.log(window.teleoperation.isConnected);

// View current data
console.log(window.teleoperation.currentData);
```

### 2. WebSocket Connection

Configure the teleoperation hook to connect to a WebSocket server:

```typescript
// In your code, modify the useTeleoperation config:
const teleoperation = useTeleoperation({
  enabled: true,
  sourceType: 'websocket',
  websocketUrl: 'ws://localhost:8080/teleoperation'
});
```

The WebSocket should send JSON messages in this format:

```json
{
  "jointPositions": {
    "joint1": 0.5,
    "joint2": -0.3
  },
  "timestamp": 1234567890
}
```

### 3. HTTP Polling

Configure the teleoperation hook to poll an HTTP endpoint:

```typescript
// In your code, modify the useTeleoperation config:
const teleoperation = useTeleoperation({
  enabled: true,
  sourceType: 'http',
  httpUrl: 'http://localhost:8080/teleoperation',
  pollingInterval: 100 // milliseconds
});
```

The HTTP endpoint should return JSON in the same format as WebSocket.

## Data Format

The teleoperation data structure supports the following fields:

```typescript
interface TeleoperationData {
  // Joint positions (in radians for revolute joints, meters for prismatic)
  jointPositions?: Record<string, number>;

  // End effector position (for future IK-based control)
  endEffectorPosition?: {
    x: number;
    y: number;
    z: number;
  };

  // End effector orientation (quaternion)
  endEffectorOrientation?: {
    x: number;
    y: number;
    z: number;
    w: number;
  };

  // Timestamp of the data
  timestamp?: number;

  // Additional metadata
  metadata?: Record<string, any>;
}
```

## Example: Python WebSocket Server

Here's a simple example of a WebSocket server that sends teleoperation data:

```python
import asyncio
import json
import websockets
import math
import time

async def teleoperation_handler(websocket, path):
    print(f"Client connected: {path}")
    try:
        # Send continuous updates
        t = 0
        while True:
            # Example: Send sinusoidal joint motions
            data = {
                "jointPositions": {
                    "joint1": math.sin(t) * 1.5,
                    "joint2": math.cos(t) * 1.0,
                    "joint3": math.sin(t * 2) * 0.5,
                },
                "timestamp": int(time.time() * 1000)
            }

            await websocket.send(json.dumps(data))
            await asyncio.sleep(0.01)  # 100 Hz update rate
            t += 0.01

    except websockets.exceptions.ConnectionClosed:
        print("Client disconnected")

async def main():
    server = await websockets.serve(
        teleoperation_handler,
        "localhost",
        8080
    )
    print("Teleoperation server running on ws://localhost:8080")
    await server.wait_closed()

if __name__ == "__main__":
    asyncio.run(main())
```

## Example: Python HTTP Server

```python
from flask import Flask, jsonify
import math
import time

app = Flask(__name__)

start_time = time.time()

@app.route('/teleoperation')
def teleoperation():
    t = time.time() - start_time

    data = {
        "jointPositions": {
            "joint1": math.sin(t) * 1.5,
            "joint2": math.cos(t) * 1.0,
            "joint3": math.sin(t * 2) * 0.5,
        },
        "timestamp": int(time.time() * 1000)
    }

    return jsonify(data)

if __name__ == '__main__':
    app.run(host='localhost', port=8080)
```

## Testing

To test teleoperation mode:

1. Load a robot URDF
2. Switch to teleoperation mode
3. Open browser console (F12)
4. Run the example commands above

Example test:

```javascript
// Test with a simple joint movement
window.teleoperation.updateData({
  jointPositions: {
    joint1: 0.0
  }
});

// Wait a moment, then move the joint
setTimeout(() => {
  window.teleoperation.updateData({
    jointPositions: {
      joint1: 1.57  // 90 degrees in radians
    }
  });
}, 1000);
```

## Future Enhancements

Planned features for teleoperation mode:

- [ ] UI controls for WebSocket/HTTP configuration
- [ ] End-effector position control with IK
- [ ] Recording and playback of teleoperation sessions
- [ ] Multiple robot support
- [ ] Velocity and force control modes
- [ ] Integration with ROS topics
