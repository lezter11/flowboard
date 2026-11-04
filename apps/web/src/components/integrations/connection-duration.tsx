export function ConnectionDuration({ offlineAccess }: { offlineAccess: boolean }) {
  return <div className="connection-duration" data-testid="connection-duration">
    <strong>{offlineAccess ? 'Continuing access' : 'One access session'}</strong>
    <p>{offlineAccess
      ? 'This app can stay connected for up to 30 days. Access ends after 7 days without renewal. Each access session lasts 15 minutes.'
      : 'One access session lasts 15 minutes. There is no continuing access or automatic renewal. Connect again when it ends.'}</p>
  </div>;
}
