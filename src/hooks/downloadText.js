export function downloadText(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  // Some browsers cancel the download if the URL is revoked synchronously.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
