# Changelog

## Unreleased

- A short description under Splash Studio in Capabilities > Plugins, and an intro at the top of its settings page, so it's clear what the plugin does
- Rewrite the line under the title, not just hide it
- A blank title now shows your profile's name (its display name if it has one) instead of "Hermes Agent". The default profile with no display name keeps "Hermes Agent". You can turn this off.
- The profile/model card shows the profile's display name too

## 1.0.0 (2026-10-09)

First public release.

- Imagery behind the new-chat splash: five presets drawn in your theme's colors, your own image, or an https image URL
- Side widgets: clock and greeting, profile and model, recent chats, and up to three starter prompts
- Title controls: text, font, size, color, glow, and hiding the title or the line under it
- Status bar chip and Cmd+K commands to toggle and customize
- Reset settings to defaults
- Only wakes up for changes to the new-chat screen, so streaming replies in other chats cost nothing
- Turning it off puts the screen back to stock, title included
- Headless test suite (`npm test`)
- Side widgets sit on their own grid, so they stay in place however wide the app makes the composer
