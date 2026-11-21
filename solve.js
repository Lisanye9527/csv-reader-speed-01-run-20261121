// A fast drop-in replacement for csv-reader 1.0.0: run(input) returns exactly csv-reader's reading of the case's
// input {text, header} — the JSON value {columns, rows, errors} — for every input, by the same broken-row policy:
//
//   - a U+FEFF at the very start of the text is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no record;
//   - outside a quoted field a CR not followed by LF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not doubled, "" inside it one quote, and each
//     CRLF or lone CR inside it read as LF; what follows its closing quote, up to the next comma or line break, is
//     appended as it stands (quote_junk, when the field ends); a quote that never closes is a literal character and
//     the text after it is read again as unquoted (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay strings, never trimmed or converted;
//   - columns is the first record when header is true, else null; rows holds the records after it (every record
//     when header is false), each padded with "" (short_row, with fields: its count) or cut (long_row, with extra:
//     the cut fields) to the first record's width;
//   - each error is {code, line, row}, in the order met, a record's short_row or long_row when it ends: line the
//     1-based line its record starts on (every LF, CRLF and lone CR inside a quoted field counted), row its
//     record's index in rows, null for the header.
//
// Where the reference reads one character at a time and builds each field a character at a time, this reader scans
// with two regexes for the next character that matters and slices whole runs of plain text at once; the state
// machine, the order errors are recorded in and every edge case are the reference's own.

/** How a field ended: at a comma (the record goes on), at a line break or at the end of the text (the record ends). */
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** The characters that end or interrupt an unquoted field. */
const RE_UNQUOTED = /[,\n\r]/g;
/** The characters that end or interrupt a quoted field. */
const RE_QUOTED = /["\r\n]/g;

/** csv-reader's answer for one case's input {text, header}: {columns, rows, errors}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const len = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (text[0] === '\uFEFF') pos = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // Reads unquoted characters onto `value` up to the next comma or line break: a CR not followed by LF is dropped
  // (stray_cr). Returns the field and how it ended; `added` counts the characters kept.
  function readUnquoted(value) {
    let added = 0;
    let segStart = pos;
    for (;;) {
      RE_UNQUOTED.lastIndex = pos;
      const m = RE_UNQUOTED.exec(text);
      if (m === null) {
        value += text.slice(segStart);
        added += len - segStart;
        pos = len;
        return { value, ended: END, added };
      }
      const i = m.index;
      const c = m[0];
      if (c === ',') {
        value += text.slice(segStart, i);
        added += i - segStart;
        pos = i + 1;
        return { value, ended: COMMA, added };
      }
      if (c === '\n') {
        value += text.slice(segStart, i);
        added += i - segStart;
        pos = i + 1;
        line += 1;
        return { value, ended: LINE_BREAK, added };
      }
      // c === '\r'
      if (text[i + 1] === '\n') {
        value += text.slice(segStart, i);
        added += i - segStart;
        pos = i + 2;
        line += 1;
        return { value, ended: LINE_BREAK, added };
      }
      // A stray CR: the run before it is kept, the CR is dropped, the field goes on.
      value += text.slice(segStart, i);
      added += i - segStart;
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      pos = i + 1;
      segStart = pos;
    }
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let p = open + 1;
    let segStart = p;
    let value = '';
    let closed = false;
    while (p < len) {
      RE_QUOTED.lastIndex = p;
      const m = RE_QUOTED.exec(text);
      if (m === null) {
        p = len;
        break;
      }
      const i = m.index;
      const c = m[0];
      if (c === '"') {
        if (text[i + 1] === '"') {
          value += text.slice(segStart, i) + '"';
          p = i + 2;
          segStart = p;
          continue;
        }
        value += text.slice(segStart, i);
        p = i + 1;
        closed = true;
        break;
      }
      if (c === '\r') {
        // CRLF and a lone CR inside quotes are each one LF.
        value += text.slice(segStart, i) + '\n';
        line += 1;
        p = text[i + 1] === '\n' ? i + 2 : i + 1;
        segStart = p;
        continue;
      }
      // c === '\n': a line is counted; the character itself stays inside the run being sliced.
      line += 1;
      p = i + 1;
    }
    if (!closed) {
      // The quote never closes: it is a literal character, and the text after it is read again as unquoted.
      pos = open + 1;
      line = openLine;
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      return readUnquoted('"');
    }
    pos = p;
    if (pos >= len) return { value, ended: END };
    const c = text[pos];
    if (c === ',') {
      pos += 1;
      return { value, ended: COMMA };
    }
    if (c === '\n') {
      pos += 1;
      line += 1;
      return { value, ended: LINE_BREAK };
    }
    if (c === '\r' && text[pos + 1] === '\n') {
      pos += 2;
      line += 1;
      return { value, ended: LINE_BREAK };
    }
    // What follows the closing quote is appended as it stands, up to the next comma or line break.
    const junk = readUnquoted(value);
    if (junk.added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    return junk;
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < len) {
      if (text[pos] === '\n') {
        pos += 1;
        line += 1;
      } else if (text[pos] === '\r' && text[pos + 1] === '\n') {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Fast path: a record that sits on one line holding no quote and no CR but its own CRLF's reads exactly as
    // that line split at its commas — no field of it is quoted, no CR of it is stray, no error can be met.
    let fields = null;
    let quoted = false;
    {
      const nl = text.indexOf('\n', pos);
      const lineEnd = nl === -1 ? len : nl;
      const rawLine = text.slice(pos, lineEnd);
      if (!rawLine.includes('"')) {
        const ri = rawLine.indexOf('\r');
        let body = null;
        if (ri === -1) body = rawLine;
        else if (nl !== -1 && ri === rawLine.length - 1) body = text.slice(pos, lineEnd - 1);
        if (body !== null) {
          fields = body.split(',');
          pos = nl === -1 ? len : nl + 1;
          if (nl !== -1) line += 1;
        }
      }
    }
    if (fields === null) {
      fields = [];
      let field;
      do {
        quoted = text[pos] === '"';
        field = quoted ? readQuoted() : readUnquoted('');
        fields.push(field.value);
      } while (field.ended === COMMA);
    }

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
