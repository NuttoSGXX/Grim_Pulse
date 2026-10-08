# Grim Pulse - Combat Turn Tracker

A dark-fantasy turn order strip for Foundry VTT V13/V14, written for the dnd5e system. It reads Foundry's own Combat encounter, so it works with anything that starts combat the normal way (including Encounter FX).

## The strip

- **Current turn** on top: a layered, chamfered frame with a 1:1 portrait, name, HP number, a lit HP bar, AC and initiative.
- **Upcoming turns** as pointed tabs with initiative, HP and a thin bar. Up to 8 turns by default.
- **Heartbeat line** behind every frame. Slower and flatter as HP drops, flat when dead.
- **Blood** from 50% HP down, heavier with every further 10% lost, with a stronger red flicker.
- **Dead** combatants lose the flicker and get a skull over a greyed portrait.
- **Dying player characters** show their death saves as three gold and three red marks.
- **Temp HP** coats part of the frame in blue with a blue aura, and adds a blue strip to the bar.
- **Healing** flashes the frame green, floats plus signs upward and lets the bar travel to its new width. Coming back from 0 HP opens a pair of wings over the frame.
- **Conditions and running effects** as red-framed chips to the right of the frame. A long name drops its next word to a new line after about 10 characters. Queued turns show at most 4 chips; the last becomes "+N More Status".
- **Disposition mark** on the left rail: green Friendly, red Hostile, yellow Neutral, purple Secret.

## Buttons under the strip

- **End turn** - GM always; a player on their own turn. It passes over any non-player combatant at 0 HP.
- **Reaction** - puts a name in the middle of everyone's screen with a random line such as "But in that very instant...". The name is the selected token, or the player's own character.
- **Skull** (GM only) - announces the selected tokens as dead. Identical names are shown once. Hostile tokens get harsh lines; neutral, secret and friendly tokens get quieter ones.

To go back a turn, use Foundry's own Combat Tracker.

## Full-screen moments

- **Round banner** from round 2 onward.
- **Death save die** when a player character starts their turn at 0 HP. Everyone sees it; only the character's owner or the GM can click it. The roll is the real dnd5e death saving throw. With Dice So Nice installed, clicking the die clears the screen, the 3D die rolls for everyone, and the skull appears only after it lands. Without it, the skull appears straight away.
  - Pass: a flame lights one eye of the skull, then the other. Third pass: wings, "Stable", and no more rolls.
  - Fail: the skull cracks, cracks further, then bursts, followed by the character's name and a random farewell line.
  - A natural 20 shows the wings and "Rises again".
- **Encounter End** fades up slowly when the combat is ended.

## What players see

- Exact HP, the HP bar and AC only for player characters. Every NPC, friendly or hostile, shows the heartbeat and blood only.
- Hidden combatants do not appear. On a hidden combatant's own turn the top frame shows "???".
- Secret-disposition combatants show "???" instead of their name.

## Settings

The colour theme is a world setting: the GM picks it and every player's strip follows. Other settings: size (per player), turns shown, who gets exact numbers, portrait or token image, End turn skipping the dead, the death save die, the round banner, Encounter End, and hiding Foundry's Combat Tracker from players.

## Changing the random lines

All lines live in the `PHRASES` block at the top of `scripts/main.js`: `reaction`, `fallen`, `slainHostile`, `slainOther`. Add, remove or reword them freely.

## Install

```
https://github.com/NuttoSGXX/Grim_Pulse/releases/latest/download/module.json
```

For a release, attach `module.json` and `module.zip` to a GitHub Release tagged `v0.2.2`.
