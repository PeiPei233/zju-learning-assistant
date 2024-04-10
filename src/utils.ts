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


export function convertUrlsToMarkdown(text: string): string {
    const markdownLinkRegex = /\[([^\]]*)\]\((http[s]?:\/\/[^\s\[\]()]+)\)/g;
    let placeholders: string[] = [];
    let currentIndex = 0;
    let newText = text.replace(markdownLinkRegex, (match) => {
        placeholders.push(match);
        return `<<${currentIndex++}>>`;
    });

    const urlRegex = /http[s]?:\/\/[^\s\[\]()]+/g;
    newText = newText.replace(urlRegex, (match) => `[${match}](${match})`);

    placeholders.forEach((placeholder, index) => {
        newText = newText.replace(`<<${index}>>`, placeholder);
    });

    return newText;
}