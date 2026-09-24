import { describe, expect, it } from 'vitest';
import { TABLE_MOBILE_HIDDEN, TABLE_PHONE_ONLY } from '../plugins/chatbot/src/adminContract';

/** The responsive visibility classes the chatbot tables wear. Both are static literals beside each other
 *  in the contract: Tailwind only generates classes it can read in the source, so building either of them
 *  dynamically would silently drop the styling. This pins the literals. */
describe('chatbot responsive visibility classes', () => {
  it('keeps both visibility classes as static literals', () => {
    expect(TABLE_MOBILE_HIDDEN).toBe('@max-[40rem]:hidden');
    expect(TABLE_PHONE_ONLY).toBe('@min-[40rem]:hidden');
  });
});
