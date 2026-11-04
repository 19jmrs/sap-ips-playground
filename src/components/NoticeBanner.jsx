export default function NoticeBanner({ notice, onDismiss }) {
  if (!notice) return null;
  const isError = notice.tone === 'error';
  return (
    <div className={`notice-banner ${isError ? 'error-banner' : 'info-banner'}`} role={isError ? 'alert' : 'status'}>
      <strong>{notice.title}</strong>
      <span>{notice.message}</span>
      <button className="text-button" onClick={onDismiss} aria-label="Dismiss message">
        Dismiss
      </button>
    </div>
  );
}
