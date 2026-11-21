# Icons

The technology icons of Vitrine, one SVG per name in `src/icon-names.ts`, which `resolveIcon` in `src/icons.ts` reads.

- Most come from [Simple Icons](https://github.com/simple-icons/simple-icons) (CC0 1.0), with the brand colour as `fill`. A logo that is black or very dark there is a neutral grey `#6b7280` here, as an `<img>` cannot inherit `currentColor` and a black logo vanishes in a dark colour mode.
- `java` is OpenJDK's Duke (BSD-3-Clause), as Simple Icons carries it.
- `gitlab` and `harbor` are the artwork of those projects, `nexus` a plain placeholder: see `src/source-looks.ts`.

To add one: put `<name>.svg` here, add `<name>` to `ICON_NAMES`, and map to it from `NEXUS_FORMATS`, `IMAGES` or `ALIASES` in `src/icon-names.ts`. `tests/icon-names.test.ts` fails if a name has no file or a file no name.
