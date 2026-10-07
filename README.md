# Grim Pulse - Combat Turn Tracker

A dark-fantasy turn order strip for Foundry VTT V13/V14, written for the dnd5e system. It reads Foundry's own Combat encounter, so it works with anything that starts combat the normal way (including Encounter FX).

## What it shows

- **Current turn** on top as a glowing 1:1 portrait frame with name, HP, AC and initiative.
- **Upcoming turns** as smaller tabs with initiative and HP. Up to 8 turns by default.
- **Heartbeat line** behind every frame. It beats slower and flatter as HP drops, and goes flat at 0 HP.
- **Blood** from 50% HP down. Every further 10% lost adds more blood and a stronger red flicker.
- **Conditions and running effects** (Stunned, Prone, Rage, Innate Sorcery, Concentration...) as names to the right of the frame. Queued turns show at most 4 lines; the last one becomes "+ N More Status".
- **Disposition mark** on the left rail: green Friendly, red Hostile, yellow Neutral, purple Secret.
- **Round divider** in the strip where the next round begins, and a **Round banner** that dims the screen and sweeps across it when a new round starts.

## What players see

- Exact HP and AC only for player characters. Every NPC, friendly or hostile, shows the heartbeat and blood only.
- Hidden combatants do not appear. On a hidden combatant's own turn the top frame shows "???".
- Secret-disposition combatants show "???" instead of their name.
- A player sees an "End turn" button on their own turn.

The GM always sees every number and gets previous/next turn buttons on the handle.

## Using it

- Drag the "Round" plate to move the strip. Double-click it to put it back on the left.
- Click a frame to pan to that token. Hover a frame to highlight the token.
- Settings: colour theme (4, same as Grim Almanac), size, turns shown, who gets exact numbers, portrait or token image, round banner, and hiding Foundry's Combat Tracker from players.

## Install

Paste the manifest URL into Foundry's Install Module dialog:

```
https://github.com/NuttoSGXX/Grim_Pulse/releases/latest/download/module.json
```

For a release, attach `module.json` and `module.zip` to a GitHub Release tagged `v0.1.0`.
