import { DatabaseSync } from 'node:sqlite';

const d = new DatabaseSync(':memory:');
d.exec("CREATE VIRTUAL TABLE t USING fts5(x, tokenize = 'unicode61 remove_diacritics 2')");
d.prepare('INSERT INTO t(rowid, x) VALUES (?, ?)').run(1, 'الحب في زمن الكوليرا 2007');
d.prepare('INSERT INTO t(rowid, x) VALUES (?, ?)').run(2, 'parasite 기생충 2019');
console.log('arabic prefix:', d.prepare("SELECT rowid, x FROM t WHERE t MATCH ?").all('"الحب"*'));
console.log('latin prefix:', d.prepare("SELECT rowid, x FROM t WHERE t MATCH ?").all('"para"*'));
console.log('bm25 order:', d.prepare('SELECT rowid, bm25(t, 8.0, 2.0) AS s FROM t WHERE t MATCH ? ORDER BY s').all('"2019"*'));
