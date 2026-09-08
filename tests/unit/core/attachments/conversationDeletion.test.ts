import '@/providers';

import { VaultDurableStorage } from '@/app/storage/VaultDurableStorage';
import { AttachmentStore } from '@/core/attachments/AttachmentStore';
import { SessionStorage } from '@/core/bootstrap/SessionStorage';
import GrimoirePlugin from '@/main';

function setup() {
  const textFiles = new Map<string, string>();
  const binaryFiles = new Map<string, ArrayBuffer>();
  const adapter = {
    coordinationKey: {},
    exists: async (path: string) => textFiles.has(path) || binaryFiles.has(path),
    read: async (path: string) => textFiles.get(path)!,
    write: async (path: string, content: string) => { textFiles.set(path, content); },
    rename: async (from: string, to: string) => { textFiles.set(to, textFiles.get(from)!); textFiles.delete(from); },
    delete: async (path: string) => { textFiles.delete(path); binaryFiles.delete(path); },
    listFilesRecursive: async (prefix: string) => [...textFiles.keys()].filter(path => path.startsWith(prefix + '/')),
    listFiles: async (prefix: string) => [...textFiles.keys(), ...binaryFiles.keys()].filter(path => path.startsWith(prefix + '/')),
    readBinary: async (path: string) => binaryFiles.get(path)!,
    writeBinary: async (path: string, bytes: ArrayBuffer) => { binaryFiles.set(path, bytes); },
    getResourcePath: (path: string) => path,
  };
  const attachments = new AttachmentStore(adapter);
  const sessions = new SessionStorage(adapter as never, new VaultDurableStorage(adapter));
  const plugin = new GrimoirePlugin({ workspace: { getLeavesOfType: () => [] } } as never, {} as never);
  (plugin as any).storage = { sessions, attachments };
  (plugin as any).conversations = [{ id: 'delete-me', providerId: 'codex', messages: [] }];
  return { plugin, attachments, sessions, textFiles };
}

test('deleting another conversation must retain draft attachments', async () => {
  const { plugin, attachments } = setup();
  const draft = await attachments.put(new Uint8Array([1, 2, 3]).buffer, 'image/png');
  await plugin.deleteConversation('delete-me');
  expect(await attachments.read(draft.hash, draft.mediaType)).not.toBeNull();
});

test('deleting another conversation must retain future-schema attachments', async () => {
  const { plugin, attachments, textFiles, sessions } = setup();
  const image = await attachments.put(new Uint8Array([1, 2, 3]).buffer, 'image/png');
  textFiles.set('.grimoire/sessions/future.meta.json', JSON.stringify({
    schemaVersion: 2, recordId: 'future', revision: 1, updatedAt: 1,
    payload: { id: 'future', title: 'Future', createdAt: 1, updatedAt: 1,
      messages: [{ id: 'm', role: 'user', content: 'image', timestamp: 1,
        images: [{ ...image, id: 'i', data: '', name: 'picture.png' }] }],
    },
  }));
  expect((await sessions.listConversations()).unreadable).toHaveLength(1);
  await plugin.deleteConversation('delete-me');
  expect(await attachments.read(image.hash, image.mediaType)).not.toBeNull();
});
