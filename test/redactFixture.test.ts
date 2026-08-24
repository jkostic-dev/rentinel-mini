import assert from "node:assert/strict";
import test from "node:test";
import { redactFixture } from "../scripts/redactFixture.ts";

const redact = (body: string, keepWords: string[] = []) =>
  redactFixture(body, keepWords, "salt");

test("scrambles words, keeping short ones, numbers, and the words it is told to keep", () => {
  const html = redact(
    "<p>Stan u ulici Petra Petrovića, 40 m2, 400 € Kvadratura</p>",
    ["Kvadratura"],
  );

  assert.doesNotMatch(html, /Petra|Petrovića|ulici|Stan\b/);
  assert.ok(html.includes(" u "));
  assert.ok(html.includes("40 m2, 400 € Kvadratura"));
});

test("scrambles a link's path and a numeric id, and leaves the site's origin", () => {
  const html = redact(
    '<a id="1234567890123" href="https://www.site.rs/stanovi/lep-stan-centar/1234567890123">x</a>',
    ["stanovi"],
  );

  assert.match(
    html,
    /href="https:\/\/www\.site\.rs\/stanovi\/[a-z]{3}-[a-z]{4}-[a-z]{6}\/\d{13}"/,
  );
  assert.ok(!html.includes("1234567890123"));
  assert.ok(!html.includes("centar"));
});

test("scrambles the same word the same way everywhere, so repeated links still match", () => {
  const html = redact(
    '<a href="/oglas/lep-stan/123456789">a</a><script type="application/ld+json">{"@type":"Offer","url":"/oglas/lep-stan/123456789"}</script>',
  );

  const [first, second] = [
    ...html.matchAll(/\/[a-z]+\/[a-z]{3}-[a-z]{4}\/\d{9}/g),
  ];
  assert.ok(first);
  assert.equal(second?.[0], first[0]);
  assert.ok(html.includes('"@type":"Offer"'));
});

test("keeps a hex id hex", () => {
  assert.match(
    redact('<a href="/x/0123456789abcdef01234567">x</a>'),
    /\/x\/[a-f0-9]{24}"/,
  );
});

test("scrambles a phone number, whole or written in pieces inside a description", () => {
  const pieces =
    "Izdaje se lep stan na dobroj lokaciji blizu centra grada, pozovite vlasnika na 060 123 4567 odmah";

  const html = redact(`<p>0601234567</p><p>${pieces}</p>`);

  assert.ok(!html.includes("0601234567"));
  assert.doesNotMatch(html, /060 123 4567/);
});
