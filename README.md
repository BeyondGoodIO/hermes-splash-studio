# Splash Studio for Hermes Desktop

Customize the empty new-chat screen in the [Hermes](https://github.com/NousResearch/hermes-agent) desktop app.

- **Imagery behind the splash:** five built-in presets drawn in your theme's colors, your own image, or an https image URL
- **Side widgets:** clock and greeting, profile and model, recent chats, and up to three starter prompts (clicking one fills the composer, it never sends)
- **The big title:** rewrite the text, change the font, size and color, hide it, or hide the line under it
- **An optional soft glow** in your theme's accent color

Ongoing chats are never touched. Turn Splash Studio off and everything goes back to stock. It's one plain JavaScript file with no build step and no dependencies.

<!-- Screenshots go here -->

## Install

1. Copy this repo into `~/.hermes/desktop-plugins/splash-studio`:
   ```bash
   git clone https://github.com/BeyondGoodIO/hermes-splash-studio ~/.hermes/desktop-plugins/splash-studio
   ```
   Or download the ZIP from GitHub and unzip it there. Only `plugin.js` is needed.
2. Hermes picks it up within a few seconds. If it doesn't, press Cmd+K and run **Reload desktop plugins**.
3. Open a new chat to see it. To customize, open **Settings > Plugins > Splash Studio**, or press Cmd+K and run **Customize Splash Studio**.

To update, run `git pull` in that folder, or replace `plugin.js` with the new one. If you also use Hermes's in-app **Install from Git**, it names the folder `hermes-splash-studio` instead. That works too, as long as you only keep one copy.

If you tried the pre-release version called Stagehand, delete `~/.hermes/desktop-plugins/stagehand`. Splash Studio carries your settings over on first start.

## Use

- The **splash** chip in the status bar turns Splash Studio on and off. Right-click it to open settings.
- If you don't see anything on a new chat, the app's own new-chat splash may be off. The settings page has a button to turn it back on.
- **Reset settings to defaults** at the bottom of the settings page puts everything back, except a saved image.

## Privacy

Splash Studio has no server and no tracking. It asks your own Hermes backend for your recent chat titles, the same way the app's sidebar does. The only outside request it can make is loading an image URL you type in yourself. That image is fetched from its website each time a new chat opens, so that site can see when you open new chats. A local image you choose is stored by the Hermes app on your computer and never leaves it.

## Remove

Turn it off in **Capabilities > Plugins**, or delete `~/.hermes/desktop-plugins/splash-studio`. To also clear a saved image, use **Clear saved image** in its settings first.

## Compatibility

Tested with Hermes Agent v0.21.6 and its desktop app (October 2026). Splash Studio finds the app's new-chat splash by its element names (`aui_intro`, `.wordmark`, `composer-bounds`). If a future Hermes release renames them, Splash Studio stops showing up rather than breaking anything, and it'll need a small update. Please [open an issue](https://github.com/BeyondGoodIO/hermes-splash-studio/issues) if that happens.

## Development

The plugin is `plugin.js`, plain ESM with no build step. Tests run it headlessly in jsdom with real React and a stubbed Hermes plugin SDK:

```bash
npm install
npm test
```

## License

MIT. See [LICENSE](LICENSE).

Made by [Devin Walker](https://devin.org) at Beyond Good. Not affiliated with Nous Research.
