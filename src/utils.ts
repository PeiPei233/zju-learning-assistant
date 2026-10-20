export function bytesToSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const size = parseFloat((bytes / Math.pow(k, i)).toFixed(2));
  return `${size} ${sizes[i]}`;
}

export function formatTime(secs: number): string {
  const day = Math.floor(secs / 86400)
  const hour = Math.floor((secs - day * 86400) / 3600)
  const minute = Math.floor((secs - day * 86400 - hour * 3600) / 60)
  const second = Math.floor(secs - day * 86400 - hour * 3600 - minute * 60)
  if (day > 0) {
    return `${day} 天 ${hour} 小时`
  } else if (hour > 0) {
    return `${hour} 小时 ${minute} 分`
  } else if (minute > 0) {
    return `${minute} 分 ${second} 秒`
  } else {
    return `${second} 秒`
  }
}

export function normalizeFileExtensions(extensions: readonly string[] = []): string[] {
  return Array.from(new Set(
    extensions
      .map((extension) => extension.trim().toLowerCase().replace(/^\.+/, ''))
      .filter(Boolean)
  ));
}

export function isFileExtensionExcluded(fileName: string, extensions: readonly string[] = []): boolean {
  const normalizedFileName = fileName.trim().toLowerCase();
  return normalizeFileExtensions(extensions).some((extension) => normalizedFileName.endsWith(`.${extension}`));
}


export function convertUrlsToMarkdown(text: string): string {
  const markdownLinkRegex = /\[([^\]]*)\]\((http[s]?:\/\/[^\s[\]()]+)\)/g;
  const placeholders: string[] = [];
  let currentIndex = 0;
  let newText = text.replace(markdownLinkRegex, (match) => {
    placeholders.push(match);
    return `<<${currentIndex++}>>`;
  });

  const urlRegex = /http[s]?:\/\/[^\s[\]()]+/g;
  newText = newText.replace(urlRegex, (match) => `[${match}](${match})`);

  placeholders.forEach((placeholder, index) => {
    newText = newText.replace(`<<${index}>>`, placeholder);
  });

  return newText;
}

/** Toggle a row or its visible Shift range, preserving hidden selections and key order. */
export function toggleSelection<Key>(selectedKeys: readonly Key[], visibleKeys: readonly Key[], key: Key, anchor: Key | null, shift: boolean): Key[] {
  const from = anchor === null ? -1 : visibleKeys.indexOf(anchor);
  const to = visibleKeys.indexOf(key);
  const range = shift && from >= 0 && to >= 0
    ? visibleKeys.slice(Math.min(from, to), Math.max(from, to) + 1) : [key];
  const selected = new Set(selectedKeys);
  const deselect = selected.has(key);
  range.forEach(value => deselect ? selected.delete(value) : selected.add(value));
  return [...selected];
}

/** Recompute from the current result, including courses removed or changed to pass/fail. */
export function calculateScoreTotals(rows: readonly { grade: string; grade_point: string; credits: string }[]) {
  return rows.reduce((total, row) => {
    if (!['合格', '不合格', '弃修'].includes(row.grade)) {
      const gp = Number.parseFloat(row.grade_point);
      const credit = Number.parseFloat(row.credits);
      if (Number.isFinite(gp) && Number.isFinite(credit)) {
        total.gp += gp * credit;
        total.credit += credit;
      }
    }
    return total;
  }, { gp: 0, credit: 0 });
}

/** Credit-weighted percentage grade; textual and missing grades do not participate. */
export function calculateAverageGrade(rows: readonly { grade: string; credits: string }[]) {
  let weightedGrade = 0;
  let credits = 0;
  for (const row of rows) {
    if (!row.grade.trim() || !row.credits.trim()) continue;
    const grade = Number(row.grade);
    const credit = Number(row.credits);
    if (!Number.isFinite(grade) || grade < 0 || grade > 100 || !Number.isFinite(credit) || credit <= 0) continue;
    weightedGrade += grade * credit;
    credits += credit;
  }
  return credits ? weightedGrade / credits : 0;
}

/** Refresh selection without letting filters or sorting select additional rows. */
export function refreshedSelection<K>(previous: readonly K[], available: readonly K[], autoSelect: boolean, defaults: readonly K[] = available): K[] {
  if (autoSelect) return [...defaults];
  const valid = new Set(available);
  return previous.filter(key => valid.has(key));
}

/** Credits without a GPA still count as credits, regardless of the course's system. */
export function scoreDisplayCredits(rows: readonly { grade: string; grade_point: string; credits: string }[]) {
  return calculateScoreTotals(rows).credit + rows.reduce((sum, row) => {
    const credit = Number.parseFloat(row.credits);
    return sum + (!String(row.grade_point ?? '').trim() && row.grade !== '弃修' && Number.isFinite(credit) ? credit : 0);
  }, 0);
}
