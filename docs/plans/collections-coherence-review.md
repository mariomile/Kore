# Collection e supertag — Flusso di creazione

Data: 2026-09-15. Direzione approvata dall'utente: Implementare collection
semplici mantenendo la struttura nei supertag, senza modali per crearle.

## Decisione

- Una nota resta l'unica unità di contenuto.
- Il supertag definisce proprietà e template. Assegnare #book continua a dare
  alla nota la struttura prevista dal tag.
- Una collection raccoglie note, manualmente o tramite regole, senza uno
  schema autonomo. Può mostrare le proprietà delle note raccolte.
- Lista, tabella, galleria, board e calendario sono presentazioni, non nuovi
  tipi di oggetto. Questa iterazione conserva le viste già implementate.
- Nessun tag #page o #note obbligatorio, nessun database separato, nessun tag
  nascosto assegnato alla creazione.

Questa decisione sostituisce le proposte precedenti di schema posseduto dalla
collection e di supertag ridotto ad alias della collection. TDR 0005 Amendment C
resta il contratto di proprietà e selezione; non richiede una migrazione.

## Evidenza di partenza

Review del checkout `636ac1f3` e osservazione dell'app installata v0.62.1.
All notes offriva New note; Create collection si trovava nel menu slash e
apriva un dialogo con nome, tag sorgente, relazione, inclusioni manuali e default.
Le collection vuote e senza tag erano già supportate dal writer. Le proprietà
restavano ricavate dai supertag e dai valori presenti nelle note.

Il problema era quindi l'accesso al caso semplice e la sua presentazione,
non l'assenza di un secondo modello di database.

## Intervento

1. All notes espone New collection. Il nome si scrive direttamente nella pagina;
   Enter o Create collection conferma, Cancel o Escape annulla senza creare file.
2. Il comando slash Create collection usa lo stesso form in linea. La vista
   viene inserita nel punto di testo memorizzato; non si apre un modale.
3. La collection nasce senza tag, proprietà o regole obbligatorie.
4. La nota che definisce la collection contiene anche una vista della propria
   selezione: aprendola da All notes o ricerca si accede alla raccolta.
5. Add existing notes è disponibile in tutte le viste. La collection stessa
   non è proposta tra le note da aggiungere.
6. La tabella conserva New con titolo in linea. Nelle altre viste New note crea
   la nota e la apre nell'editor.
7. I controlli di raggruppamento e colonne non occupano lo stato vuoto quando
   non esistono proprietà utilizzabili. Lo stato vuoto parla di note da aggiungere,
   senza suggerire un tag inesistente.
8. La definizione viene indicizzata prima di restituirla alla UI, così il suo
   riferimento è risolvibile quando viene inserita o aperta.

La configurazione avanzata delle regole esistente resta raggiungibile da
Configure collection. Non fa parte del flusso di creazione.

## Invarianti

- Aggiungere una nota esistente non copia il file né cambia il supertag.
- Rimuovere dalla collection modifica inclusioni/esclusioni, non elimina la nota.
- I valori restano nel frontmatter delle note; le definizioni dei campi restano
  nei supertag. Nessuna nuova autorità concorrente per le proprietà.
- La selezione si salva nella definizione Markdown esistente; gli embed
  conservano filtri e layout indipendenti.
- La stessa nota può apparire in più collection.
- Privacy, scrittura tramite sessioni aperte e controlli di generazione restano
  nei percorsi esistenti.

## Fuori scope

Nuovi schemi, migrazioni, identità dei blocchi, cambiamenti al significato degli
hashtag nelle daily, Readwise, redesign delle viste, rilascio desktop/mobile.
Non vengono modificati i contenuti del graph personale.

## Verifica

I controlli e il risultato della verifica vengono registrati in
[STATE](../STATE.md). La preview browser usa il graph dimostrativo in memoria;
non dimostra un'installazione o un aggiornamento della build nativa.
