# URDF Studio Setup

## Quick Start

### 1. Run Setup
```bash
urdf-studio setup
```

This will:
- Show a beautiful banner
- Install all dependencies
- Prompt you to configure HuggingFace authentication (optional)
- Allow you to update or remove existing tokens

### 2. Start URDF Studio
```bash
urdf-studio
# or
urdf-studio start
```

The app will start with a beautiful banner and be available at `http://localhost:5173`

## Commands

- `urdf-studio setup` - Install dependencies and configure HuggingFace
- `urdf-studio start` - Start URDF Studio (default)
- `urdf-studio` - Start URDF Studio (default)
- `urdf-studio --help` - Show help message

## HuggingFace Token

The setup script will save your HuggingFace token to `.urdf-studio-config.json` (which is gitignored).

When running setup:
- **First time**: Enter your token or press Enter to skip
- **Subsequent runs**: 
  - Press Enter to keep current token
  - Enter new token to update
  - Type "remove" to delete the token

The token is automatically loaded when you start the app and is used for uploading and managing datasets on HuggingFace Spaces.

