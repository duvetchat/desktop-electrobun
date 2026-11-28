# How Duvet's languages write (#464)

`en.json` is the source. Each other file translates it key for key. `descriptions.json` says where a string shows and what fills it; a key tagged `[short]` sits in a fixed width (a button, a tab, a menu item). Keep it about as long as the English. The English follows `docs/redesign/COPY.md`, and the other languages keep its habits: sentence case, plain words, no "Failed to…", no exclamation marks.

The mobile app copies these files (`mobile/tool/sync-desktop-strings.sh`), so a word changed here changes there.

## Format

Every value is an ICU MessageFormat string (the format Flutter's ARB files, Android and translation tools read).

- `{name}` is filled in at run time: keep it, spelled the same, and move it wherever the sentence needs it.
- `{count, plural, one {# member} other {# members}}`: translate the words inside each case, keep `#`, and give the cases your language uses (`one`, `other`; `many` is optional). Russian and Ukrainian use `one`, `few`, `many` and `other`; Chinese, Japanese, Korean, Thai and Vietnamese `other` alone. Never drop `other`.
- `{place, select, room {…} call {…} other {…}}`: one sentence per case, so each can agree in gender and case.
- `<b>…</b>`, `<link>…</link>`, `<kbd>…</kbd>`: keep each tag around the words that mean the same thing in your sentence.
- An apostrophe before `{`, `}` or `#` escapes it. Write `’` (U+2019) in French and Italian elisions (`l’app`), which ICU never reads as one.

`lib/i18n.test.ts` checks each file: the same placeholders, tags and select cases as English, plural cases your language has, and no forbidden word.

## Tone

| Language | You | Notes |
|---|---|---|
| es | tú | Neutral Latin American: no *vosotros*, no Spain-only words (*ordenador* → *computadora*, or *equipo*). A storage bucket is *bucket*, as in es-ES. Quotes “…”. |
| fr | tu | Narrow no-break space (U+202F) before `? ! : ;` and inside « … ». |
| de | du | Lower-case *du* in UI text. Quotes „…“. |
| pt-BR | você | Brazilian spelling and words (*arquivo*, *tela*, *celular*). Quotes “…”. |
| it | tu | Quotes «…». |
| fi | sinä | Informal *sinä* (2nd person singular). Quotes ”…”. |
| en-GB | you | The English, spelt and worded the British way: *-ise* (*organise*, *recognise*), *colour*, *favourite*, *centre*, *licence* (noun), *cancelled*, *mobile* (not *cell*). Everything else as English, quotes “…”. |
| es-ES | tú | Spain's Spanish: *vosotros* for more than one person, Spain's words (*ordenador*, *móvil*). Quotes «…». |
| ru | вы | Lower-case *вы*, as Russian apps write it. Quotes «…». Write *ё* where it belongs. Kick is *выгнать*, ban *забанить* (*бан*, *разбанить*); *заблокировать* is only for blocking a person. |
| uk | ви | Lower-case *ви*. Quotes «…». Ukrainian words, never Russian ones; ’ (U+2019) for the apostrophe in words (*об’єкт*). |
| zh-CN | 你 | Simplified characters, mainland words (*文件*, *设置*, *视频*). Full-width punctuation (，。？：（）), quotes “…”, no space between Chinese and Latin letters or numbers. |
| zh-TW | 你 | Traditional characters, Taiwan's words (*檔案*, *設定*, *影片*, *訊息*), not Simplified turned Traditional. Full-width punctuation, quotes 「…」. A space between Chinese and Latin letters, numbers or a placeholder (*前往 Duvet*, *踢出 {name}*), none beside full-width punctuation. Kick is *踢出*, ban *停權*: *對 {name} 停權*. |
| ja | — | です/ます; leave out *あなた*, as Japanese does. Buttons and menu items as nouns or plain verbs (*保存*, *キャンセル*). Full-width punctuation (、。？), quotes 「…」. |
| ko | — | 해요체; leave out *당신*. Buttons and menu items as nouns (*저장*, *취소*). After a placeholder, both particles: *을(를)*, *이(가)*. Quotes “…”. |
| th | คุณ | Polite and neutral, without ครับ/ค่ะ. No full stop at a sentence's end: a space between sentences. Quotes “…”. |
| vi | bạn | Quotes “…”. |

## Terms

| English | es | fr | de | pt-BR | it | fi |
|---|---|---|---|---|---|---|
| Space | Espacio | Espace | Space | Espaço | Spazio | Space |
| room | sala | salon | Raum | sala | stanza | huone |
| voice room | sala de voz | salon vocal | Sprachraum | sala de voz | stanza vocale | puhehuone |
| direct message | mensaje directo | message privé | Direktnachricht | mensagem direta | messaggio diretto | yksityisviesti |
| group | grupo | groupe | Gruppe | grupo | gruppo | ryhmä |
| Do not disturb | No molestar | Ne pas déranger | Nicht stören | Não perturbe | Non disturbare | Älä häiritse |

| English | ru | uk | zh-CN | zh-TW | ja | ko | th | vi |
|---|---|---|---|---|---|---|---|---|
| Space | Пространство | Простір | 空间 | 空間 | スペース | 스페이스 | สเปซ | Space |
| room | комната | кімната | 房间 | 房間 | ルーム | 방 | ห้อง | phòng |
| voice room | голосовая комната | голосова кімната | 语音房间 | 語音房間 | ボイスルーム | 음성 방 | ห้องเสียง | phòng thoại |
| direct message | личное сообщение | особисте повідомлення | 私信 | 私訊 | ダイレクトメッセージ | 다이렉트 메시지 | ข้อความส่วนตัว | tin nhắn riêng |
| group | группа | група | 群组 | 群組 | グループ | 그룹 | กลุ่ม | nhóm |
| Do not disturb | Не беспокоить | Не турбувати | 请勿打扰 | 請勿打擾 | 取り込み中 | 방해 금지 | ห้ามรบกวน | Không làm phiền |

en-GB keeps English's terms, and es-ES Spanish's.

Space is a name, so it keeps its capital as in English. Duvet and Duvet Premium are never translated.

## Forbidden words

Duvet says Space and room, never server and channel (#57). The same goes for each language:

| es | fr | de | pt-BR | it | fi |
|---|---|---|---|---|---|
| servidor, canal | serveur, canal | Server, Kanal | servidor, canal | server, canale | palvelin, kanava |

| en-GB | es-ES | ru | uk | zh-CN | zh-TW | ja | ko | th | vi |
|---|---|---|---|---|---|---|---|---|---|
| server, channel | servidor, canal | сервер, канал | сервер, канал | 服务器, 频道 | 伺服器, 頻道 | サーバー, チャンネル | 서버, 채널 | เซิร์ฟเวอร์, แชนแนล | máy chủ, kênh |

The only exceptions are the strings that mean the API itself (`ABOUT_THE_API` in `lib/wording.test.ts`).
