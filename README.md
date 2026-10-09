# Stagehand

A plugin for the [Hermes](https://github.com/NousResearch/hermes-agent) desktop app that customizes the empty new-chat screen.

- **Imagery behind the splash:** five built-in presets drawn in your theme's colors, your own image, or an https image URL
- **Side widgets:** clock and greeting, profile and model, recent chats, and up to three starter prompts (clicking one fills the composer, it never sends)
- **The big title:** rewrite the text, change the font, size and color, hide it, or hide the line under it
- **An optional soft glow** in your theme's accent color

Ongoing chats are never touched. Turn Stagehand off and everything goes back to stock. It's one plain JavaScript file with no build step and no dependencies.

<!-- Screenshots go here -->

## Install

1. Copy this repo into `~/.hermes/desktop-plugins/stagehand`.
   ```bash
   git clone https://github.com/BeyondGoodIO/stagehand ~/.hermes/desktop-plugins/stagehand
   ```
   Or download the ZIP from GitHub and unzip it there.
2. Hermes picks it up within a few seconds. If it doesn't, press Cmd+K and run **Reload desktop plugins**.
3. Open a new chat to see it. To customize, open **Settings > Plugins > Stagehand**, or press Cmd+K and run **Customize Stagehand**.

## Use

- The **stage** chip in the status bar turns Stagehand on and off. Right-click it to open settings.
- If you don't see anything on a new chat, the app's own new-chat splash may be off. The settings page has a button to turn it back on.

## Privacy

Stagehand has no server and no tracking. It asks your own Hermes backend for your recent chat titles, the same way the app's sidebar does. The only outside request it can make is loading an image URL you type in yourself. That image is fetched from its website each time a new chat opens, so that site can see when you open new chats. A local image you choose is stored by the Hermes app on your computer and never leaves it.

## Remove

Turn it off in **Capabilities > Plugins**, or delete `~/.hermes/desktop-plugins/stagehand`. To also clear a saved image, use **Clear saved image** in its settings first.

## Compatibility

Tested with the Hermes desktop app as of October 2026. Stagehand finds the app's new-chat splash by its element names (`aui_intro`, `.wordmark`, `composer-bounds`). If a future Hermes release renames them, Stagehand stops showing up rather than breaking anything, and it'll need a small update.

## License

MIT. See [LICENSE](LICENSE).

Not affiliated with Nous Research.
