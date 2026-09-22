# Scegliere il tipo di nota, invece di scrivere il tag nel testo

**Stato:** analisi e proposta, nessuna riga di codice. Da decidere.
**Data:** 2026-09-21, contro `master` a f96826d (v0.70.2).
**Origine:** "dobbiamo rivedere il sistema di tag e supertag. Forse dovremmo
far selezionare il tipo di nota senza far fare il Tag ovunque nella nota."

---

## TL;DR

Il modello dati non ha bisogno di essere rivisto: è già corretto. Quello che
manca è il gesto. Oggi l'unico modo di dare un tipo a una nota è scrivere
`#tag` dentro la prosa, e il campo Type che sta sopra al corpo sa solo
mostrare e togliere, non aggiungere. Aggiungere un selettore di tipo costa
una slice piccola e non rompe niente.

Poi c'è una seconda domanda, separata e più grossa: se il tipo debba vivere
nel frontmatter invece che nel corpo. La risposta è sì, ma come **seconda
sorgente** accanto all'hashtag, non al posto suo. Quella è una slice media
con una rottura reale da mettere in conto, e va decisa a parte.

---

## Come funziona oggi

L'appartenenza a un tag si deriva **solo** dagli `#hashtag` nel corpo della
nota. Il frontmatter non è una sorgente: una chiave `tags:` viene proiettata
come proprietà qualunque, non come appartenenza. È scritto nero su bianco in
[TDR 0005](decisions/0005-tag-types-and-collections.md) e implementato in
`collectTags` (`packages/core/src/markdown/extract.ts:204`), che scansiona
solo `body`. Tutto il resto scende da lì: `parseNote` restituisce
`tags: [...]` (`extract.ts:400`), `indexed-note.ts:466` le mappa nella
tabella `tags`, e da quella tabella pescano le collection, i filtri
`tag:`, la pagina del tag, l'FTS.

Lo schema di un tag sta in `tags/<nome>.md` con marker `lore: tag`; i valori
delle proprietà stanno nel frontmatter della singola nota come chiavi piatte.
Quindi oggi **l'appartenenza sta nel corpo e i dati stanno nel frontmatter**:
una separazione che non ha una ragione di design, ha una ragione storica
(TDR 0004 è precedente ai supertag).

I modi in cui un tag finisce su una nota, tutti quanti:

1. Scriverlo a mano nell'editor, con l'autocomplete `#` (`use-editor-autocomplete.ts:211`).
2. L'azione bulk su una selezione (`use-note-bulk-actions.ts:117`).
3. Nascere come riga di una collection: "+ New" della tabella, una corsia
   del board, un giorno del calendario (`create-collection-note.ts`).
4. L'import CSV (`collection-import.tsx:122`).
5. Il gesto Tana sul daily: clicchi un `#tag` dentro una riga e la trasformi
   in nota (`tag-actions-menu.tsx`).
6. La CLI: `reflect tag <nota> <tag>` (`apps/cli/src/commands/tag.rs:46`).

Tutti e sei passano per `appendBodyTag`, che appende `#tag` su una riga in
fondo al corpo. Non esiste un settimo modo, e in particolare **non esiste un
modo che non tocchi il testo della nota**.

Il campo Type c'è già (`note-type-field.tsx`), sopra al corpo e nel rail di
destra: una chip per ogni tag con schema, con la X che toglie. Ma:

- ritorna `null` quando la nota non ha tipi, quindi su una nota nuova il
  campo non esiste proprio;
- non ha nessun affordance di aggiunta, solo la rimozione.

Una cosa buona che c'è già: quando la nota mostra l'header delle proprietà,
il paragrafo composto solo da tag in testa o in coda viene collassato via CSS
(`tag-membership-paragraph.ts`). Quindi metà del fastidio di Mario è già
risolta visivamente. Solo metà però: il collasso vale unicamente per il primo
e l'ultimo paragrafo, e un `#book` scritto in mezzo a una frase resta lì.

Ultimo buco, per completezza: la chat AI sa listare i tag, leggere una
collection, scrivere una proprietà, cambiare icona e schema di un tag
(`list_tags`, `list_collection`, `set_note_property`, `set_tag_icon`,
`set_tag_schema`), ma **non sa dare un tipo a una nota**. Anche l'agente
deve passare dalla prosa.

---

## Cosa manca davvero

Non il modello. Il modello "il tag è la collection, lo schema è opzionale,
i valori stanno nella nota" regge ed è la cosa migliore di Kore rispetto a
Notion. Quello che manca sono tre cose, in ordine di quanto pesano:

**1. Il gesto di assegnazione.** "Questa nota è un Libro" è un'affermazione
di metadato, e in Kore si esprime scrivendo prosa. È l'idioma Tana, non
quello Craft/Linear verso cui il prodotto sta convergendo. Con il campo Type
già lì che mostra il tipo, l'assenza del picker si legge come un bug, non
come una scelta.

**2. La fragilità.** Il tipo di una nota è a un backspace di distanza
dall'essere perso. Cancelli la riga sbagliata mentre editi e la nota esce
dalla collection, in silenzio, senza conferma. Nessun altro metadato in Kore
è così esposto: titolo, alias, private, pinned, icona, cover e tutte le
proprietà stanno nel frontmatter, protette dall'editor.

**3. Il Markdown su disco.** Una riga `#book` in fondo al file è rumore in
qualunque editor esterno e in qualunque export. Chi apre il vault con
Obsidian vede la riga; chi lo apre con un editor di testo pure. Non è
drammatico (è la convenzione Obsidian), ma è una scelta che oggi non è stata
fatta, è stata ereditata.

---

## Proposta

Due slice, indipendenti, da decidere separatamente. La prima risponde alla
richiesta com'è formulata. La seconda risponde al problema che c'è sotto.

### Slice A: il selettore di tipo (nessun cambio di storage)

Il campo Type diventa scrivibile. Sempre presente sulla nota, anche vuoto,
con uno stato muto "Empty"; ci clicchi sopra e si apre un picker di tag che
scrive il tag con `appendBodyTag`, esattamente come lo scriverebbe l'editor.
Il paragrafo di appartenenza viene già collassato dal CSS esistente, quindi
dal punto di vista dell'utente il tag **non appare nel testo**: appare nel
campo Type, dove deve stare.

Il picker propone prima i tag con schema (quelli che sono davvero "tipi") e
sotto tutti gli altri, riusando il `suggestTags` già scritto per
l'autocomplete `#`. La nota nata così riceve anche gli stamp `created` dello
schema, come già fa la CLI (`missing_stamps` in `tag.rs`).

**Default che scelgo io, perché la richiesta si biforca qui:** il campo Type
vuoto compare su ogni nota ordinaria ma **non sui daily**. Un daily raccoglie
tag inline per natura e non ha un tipo proprio; metterci un campo Type vuoto
in testa ogni mattina sarebbe rumore puro. Se preferisci il contrario è una
riga.

Con questo, "non far fare il Tag ovunque nella nota" è soddisfatto per il
caso normale, senza toccare niente di strutturale.

**Costo:** piccolo. Un hook `use-add-note-tag.ts` speculare a
`use-remove-note-tag.ts`, il picker, la rimozione dell'early return in
`note-type-field.tsx` e nei due contenitori (`note-properties-header.tsx`,
`note-properties-section.tsx`), più i test browser sui due engine. Zero Rust,
zero migrazioni, zero cambi all'indice. Una PR.

**Cosa si rompe:** niente. Nessun file esistente cambia di significato.

### Slice B: il frontmatter come seconda sorgente di appartenenza

Questa è la decisione vera, e TDR 0005 la lascia esplicitamente aperta:
"Widening tag extraction to frontmatter is a possible follow-up, decided
separately".

La proposta è: l'appartenenza diventa l'**unione** di due sorgenti, gli
hashtag nel corpo e una chiave di frontmatter. Non una che sostituisce
l'altra. L'hashtag inline resta valido per sempre, perché i casi che serve
sono reali e belli: `Sto leggendo #book stasera` dentro un daily, il gesto
Tana che trasforma una riga in nota, l'interoperabilità con Obsidian. Il
picker della slice A scrive nel frontmatter; l'editor continua a scrivere
nel corpo; il campo Type toglie da dove trova.

**Quale chiave: `tags:`.** È quello che significa in ogni altro strumento
Markdown (Obsidian, Foam, Quartz), è una lista quindi regge i due tipi che
il campo Type già gestisce, e importare un vault Obsidian farebbe la cosa
giusta invece di quella sorprendente. L'alternativa `type:` legge meglio al
singolare ma mente (una nota può avere due tipi) ed è una parola troppo
comune per riservarla.

Il punto architetturalmente comodo: il collo di bottiglia è uno solo.
`collectTags` in `extract.ts` riceve un passaggio sul frontmatter, e da lì
in giù **tutto il resto funziona già**: tabella `tags`, collection, filtri
`tag:`, pagina del tag, FTS, contatori. Non serve nessuna migrazione SQL
(la forma della tabella non cambia), basta un bump di `PROJECTION_VERSION`
(oggi 25) che forza la riproiezione alla prossima apertura.

**Costo:** medio. In ordine:

- `collectTags` legge anche il frontmatter, con i test relativi.
- `tags` entra in `RESERVED_FRONTMATTER_KEYS` (`tag-type.ts:197`), con la
  stessa deroga che ha già il marker delle collection in `properties.ts:47`,
  altrimenti il canale di scrittura delle proprietà non può toccarla.
- Un nuovo `packages/core/src/markdown/frontmatter-tag.ts` con
  `addFrontmatterTag` / `removeFrontmatterTag`, stesso contratto
  null-o-scrittura di `body-tag.ts`.
- `use-remove-note-tag.ts` deve pulire entrambe le sorgenti.
- Il mirror Rust della CLI: `apps/cli/src/body_tag.rs` ha la sua copia di
  `append_body_tag` / `remove_trailing_tag`, e `reflect tag` / `reflect untag`
  devono scegliere il canale.
- Le due skill (`kore-markdown/SKILL.md` riga 55 dice esplicitamente il
  contrario oggi, `kore-collections/SKILL.md`) e un emendamento a TDR 0005.

Una PR per core e desktop, la CLI Rust può seguire o viaggiare insieme.

**Cosa si rompe, concretamente:**

1. **Le note che hanno già `tags:` nel frontmatter entrano nelle collection.**
   È la rottura vera. Un vault importato da Obsidian con `tags: [idea, wip]`
   si ritrova due collection popolate senza averlo chiesto. Nel merito è
   probabilmente quello che l'utente voleva, ma è un cambio di comportamento
   silenzioso su file esistenti. Prima di decidere va misurato sul tuo vault:
   quante note hanno `tags:` nel frontmatter oggi. Io da qui non posso
   guardarlo.
2. **`tags` sparisce come colonna dati.** Diventando riservata non viene più
   proiettata in `note_properties`, quindi se in qualche collection la stavi
   usando come proprietà normale quella colonna si svuota.
3. **Interoperabilità al contrario.** Una nota tipizzata dal picker non ha
   più `#tag` nel corpo, quindi uno strumento esterno che legge solo gli
   hashtag non vede più l'appartenenza. Con `tags:` come chiave questo vale
   per pochi strumenti, perché Obsidian legge entrambe.
4. **Niente altro.** SQLite non cambia forma, la storia della chat non viene
   toccata, i file esistenti restano leggibili identici.

### Slice C, se le prime due passano: `set_note_type` in chat

Una volta che l'appartenenza ha un canale che non è la prosa, darla
all'agente è quasi gratis, ed è la slice successiva naturale della mappa
AI-app-control (dopo icona e schema, il tipo). Propose-then-accept come le
altre, stesso gate privacy.

---

## Cosa consiglio

Fai la slice A da sola e provala per qualche giorno. Risolve la richiesta
come l'hai formulata, costa poco e non impegna a niente. La slice B è la
scelta giusta sul lungo periodo ma ha una rottura da misurare prima, e non
c'è nessun motivo di accoppiarla: il picker scriverà nel corpo oggi e nel
frontmatter domani senza che l'utente veda la differenza.

Quello che **non** consiglio è togliere l'hashtag inline. È il gesto più
veloce che c'è per marcare qualcosa mentre scrivi, e il collasso del
paragrafo di appartenenza lo rende già invisibile dove darebbe fastidio.
