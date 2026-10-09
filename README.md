# Stagehand

Dress up the empty new-chat screen in the Hermes desktop app.

- Imagery behind the splash: five built-in presets, your own image, or an image URL
- Side widgets: clock and greeting, profile and model, recent chats, starter prompts (click to fill the composer, never sends)
- The big title: rewrite the text, change font, size and color, hide it, or hide the line under it
- Optional soft glow in your theme's accent color

Ongoing chats are never touched. Everything is plain CSS and DOM on the new-chat screen, with no build step.

## Install

1. Copy this folder to `~/.hermes/desktop-plugins/stagehand`
2. In Hermes, press Cmd+K and run "Reload desktop plugins"
3. Open Settings > Plugins > Stagehand

## Remove

Turn it off in Settings > Plugins, or delete the folder.

## Notes

- Title rewriting edits the text on the page, not Hermes itself, so it should survive app updates. If a future Hermes release renames the splash elements (`aui_intro`, `.wordmark`), the title controls will need a small selector update.
- Not affiliated with Nous Research.
