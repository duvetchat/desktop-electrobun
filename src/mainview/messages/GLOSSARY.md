# How Duvet's languages write (#464)

`en.json` is the source. Each other file translates it key for key. `descriptions.json` says where a string shows and what fills it; a key tagged `[short]` sits in a fixed width (a button, a tab, a menu item). Keep it about as long as the English. The English follows `docs/redesign/COPY.md`, and the other languages keep its habits: sentence case, plain words, no "Failed to…", no exclamation marks.

The mobile app copies these files (`mobile/tool/sync-desktop-strings.sh`), so a word changed here changes there.

## Format

Every value is an ICU MessageFormat string (the format Flutter's ARB files, Android and translation tools read).

- `{name}` is filled in at run time: keep it, spelled the same, and move it wherever the sentence needs it.
- `{count, plural, one {# member} other {# members}}`: translate the words inside each case, keep `#`, and give the cases your language uses (`one`, `other`; `many` is optional). Never drop `other`.
- `{place, select, room {…} call {…} other {…}}`: one sentence per case, so each can agree in gender and case.
- `<b>…</b>`, `<link>…</link>`, `<kbd>…</kbd>`: keep each tag around the words that mean the same thing in your sentence.
- An apostrophe before `{`, `}` or `#` escapes it. Write `’` (U+2019) in French and Italian elisions (`l’app`), which ICU never reads as one.

`lib/i18n.test.ts` checks each file: the same placeholders, tags and select cases as English, plural cases your language has, and no forbidden word.

## Tone

| Language | You | Notes |
|---|---|---|
| es | tú | Neutral Latin American: no *vosotros*, no Spain-only words (*ordenador* → *computadora*, or *equipo*). Quotes “…”. |
| fr | tu | Narrow no-break space (U+202F) before `? ! : ;` and inside « … ». |
| de | du | Lower-case *du* in UI text. Quotes „…“. |
| pt-BR | você | Brazilian spelling and words (*arquivo*, *tela*, *celular*). Quotes “…”. |
| it | tu | Quotes «…». |
| fi | sinä | Informal *sinä* (2nd person singular). Quotes ”…”. |

## Terms

| English | es | fr | de | pt-BR | it | fi |
|---|---|---|---|---|---|---|
| Space | Espacio | Espace | Space | Espaço | Spazio | Space |
| room | sala | salon | Raum | sala | stanza | huone |
| voice room | sala de voz | salon vocal | Sprachraum | sala de voz | stanza vocale | puhehuone |
| direct message | mensaje directo | message privé | Direktnachricht | mensagem direta | messaggio diretto | yksityisviesti |
| group | grupo | groupe | Gruppe | grupo | gruppo | ryhmä |
| Do not disturb | No molestar | Ne pas déranger | Nicht stören | Não perturbe | Non disturbare | Älä häiritse |

Space is a name, so it keeps its capital as in English. Duvet and Duvet Premium are never translated.

## Forbidden words

Duvet says Space and room, never server and channel (#57). The same goes for each language:

| es | fr | de | pt-BR | it | fi |
|---|---|---|---|---|---|
| servidor, canal | serveur, canal | Server, Kanal | servidor, canal | server, canale | palvelin, kanava |

The only exceptions are the strings that mean the API itself (`ABOUT_THE_API` in `lib/wording.test.ts`).
