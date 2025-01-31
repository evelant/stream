import { pipe } from "@effect/data/Function"
import * as Deferred from "@effect/io/Deferred"
import * as Effect from "@effect/io/Effect"
import * as Exit from "@effect/io/Exit"
import * as Ref from "@effect/io/Ref"
import * as Channel from "@effect/stream/Channel"
import * as it from "@effect/stream/test/utils/extend"
import { assert, describe } from "vitest"

describe.concurrent("Channel", () => {
  it.effect("catchAll - structure confusion", () =>
    Effect.gen(function*($) {
      const channel = pipe(
        Channel.write(8),
        Channel.catchAll(() =>
          pipe(
            Channel.write(0),
            Channel.concatMap(() => Channel.fail("error1"))
          )
        ),
        Channel.concatMap(() => Channel.fail("error2"))
      )
      const result = yield* $(Effect.exit(Channel.runCollect(channel)))
      assert.deepStrictEqual(Exit.unannotate(result), Exit.fail("error2"))
    }))

  it.effect("error cause is propagated on channel interruption", () =>
    Effect.gen(function*($) {
      const deferred = yield* $(Deferred.make<never, void>())
      const finished = yield* $(Deferred.make<never, void>())
      const ref = yield* $(Ref.make<Exit.Exit<never, void>>(Exit.unit))
      const effect = pipe(
        Deferred.succeed<never, void>(deferred, void 0),
        Effect.zipRight(Effect.never)
      )
      yield* $(
        Channel.fromEffect(effect),
        Channel.runDrain,
        Effect.onExit((exit) => Ref.set(ref, exit as Exit.Exit<never, void>)),
        Effect.ensuring(Deferred.succeed(finished, void 0)),
        Effect.race(Deferred.await(deferred)),
        Effect.either
      )
      yield* $(Deferred.await(finished)) // Note: interruption in race is now done in the background
      const result = yield* $(Ref.get(ref))
      assert.isTrue(Exit.isInterrupted(result))
    }))

  it.effect("scoped failures", () =>
    Effect.gen(function*($) {
      const channel = Channel.scoped(Effect.fail("error"))
      const result = yield* $(Channel.runCollect(channel), Effect.exit)
      assert.deepStrictEqual(Exit.unannotate(result), Exit.fail("error"))
    }))
})
