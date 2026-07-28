from pathlib import Path

path = Path("spikes/host-integration/tests/host-integration.test.mjs")
text = path.read_text()
old = 'changeset propose --kind <workspace.init|config.update|scope.add|guide.update> --payload-file <file|-> --actor <actor>'
new = 'changeset propose --kind <workspace.init|config.update|scope.add|scope.generator.set|guide.update> --payload-file <file|-> --actor <actor>'
if old not in text:
    raise SystemExit("host integration help expectation not found")
path.write_text(text.replace(old, new, 1))
