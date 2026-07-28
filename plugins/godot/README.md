# Punaab Godot Plugin 0.1.0

Drop an AI traveling bard into your Godot 4 game in about five minutes.

## Install

1. Download `punaab-godot-0.1.0.zip` from the [Punaab dashboard](https://punaab.com/dashboard/downloads).
2. Unzip so you have `res://addons/punaab/` in your Godot project.
3. **Project → Project Settings → Plugins** → enable **Punaab**.
4. Create or open a scene, add a **Punaab** node (Node2D).
5. In the inspector, set:
   - `api_key` — from Dashboard → API Keys
   - `api_base` — `https://punaab.com` (or `http://127.0.0.1:3000` for local)
6. Run the scene. Talk in the dialogue panel.

## Behaviors

Cloud replies may include behaviors: `idle`, `talk`, `sing`, `play_music`, `open_shop`, `tell_story`, `start_quest`, `wave`, `dance`.

Wire an `AnimationPlayer` via the BehaviorBus `animation_player_path`, or implement methods with those names on the Punaab node parent.

## API used

- `GET /api/v1/config`
- `POST /api/v1/dialogue`
- `GET /api/v1/merchant`
- `GET /api/v1/music`

Never put OpenAI keys in the plugin — only your project API key.
