import subprocess,tarfile,io,pathlib,tempfile
root=pathlib.Path(tempfile.mkdtemp(prefix='flowboard-perf-old-',dir='/private/tmp'))
raw=subprocess.check_output(['git','archive','3a82b24','apps/api/src','packages/contracts'])
with tarfile.open(fileobj=io.BytesIO(raw)) as archive:archive.extractall(root,filter='data')
folder=pathlib.Path(__file__).resolve().parent
(folder/'old-source-path.txt').write_text(str(root)+'\n')
print('Prepared isolated tracked old source; no dependencies installed or network calls.')
