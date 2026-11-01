export function formatSize(bytes: number) {
	const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
	let size = bytes;
	let unit = 0;
	while (size >= 1024 && unit < units.length - 1) {
		size /= 1024;
		unit++;
	}
	return `${Number(size.toFixed(1))} ${units[unit]}`;
}

export function formatDate(date: string) {
	return date.slice(0, 10);
}

export function initialsOf(name: string) {
	return name
		.split(/\s+/)
		.map((word) => word.charAt(0))
		.join('')
		.slice(0, 2)
		.toUpperCase();
}
