import assert from 'node:assert/strict';

// Shared account contract, exercised through each adapter's actual transport.
// Account intent persists even when the selected model cannot honor Fast mode.
export async function verifyFastPreference({ baseUrl, token, command, offReply, usageReply, turn, model }) {
  const storedFast = async (expected) => {
    const res = await fetch(`${baseUrl}/auth/me/cli-settings`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200, 'read persisted account preference');
    assert.equal((await res.json()).fastMode, expected, 'persisted account Fast preference');
  };
  const status = (on) => (text) => text === `Fast mode is ${on ? 'on' : 'off'}; the selected model does not support it.`;
  const unsupportedOn = (text) => text.includes('Fast mode is on for your account, but the selected model does not support it.');

  await command('off', offReply);
  await storedFast(false);
  // Text adapters accept arbitrary input; Discord restricts its native option to registered choices.
  if (usageReply) await command('wat', usageReply);
  await storedFast(false);
  await command('status', status(false));
  await storedFast(false);
  await command('on', unsupportedOn);
  await storedFast(true);
  // Explicit on is idempotent, not a toggle; status and invalid input never mutate intent.
  await command('on', unsupportedOn);
  await command('status', status(true));
  // Text adapters accept arbitrary input; Discord restricts its native option to registered choices.
  if (usageReply) await command('wat', usageReply);
  await storedFast(true);

  const before = model.requests.length;
  await turn();
  const requests = model.requests.slice(before);
  assert.ok(requests.length > 0, 'Fast preference on still permits a real model turn');
  for (const request of requests) {
    assert.equal(request.body.model, 'mock-model', 'unsupported route retains the selected model');
    assert.notEqual(request.body.service_tier, 'priority', 'unsupported route does not send priority service tier');
  }
  await storedFast(true);
  await command('', offReply);
  await storedFast(false);
  await command('', unsupportedOn);
  await storedFast(true);
  await command('off', offReply);
  await command('status', status(false));
  await storedFast(false);
}
