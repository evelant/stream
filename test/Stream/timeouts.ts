import * as Chunk from "@effect/data/Chunk"
import * as Duration from "@effect/data/Duration"
import * as Either from "@effect/data/Either"
import * as Option from "@effect/data/Option"
import * as Cause from "@effect/io/Cause"
import * as Effect from "@effect/io/Effect"
import * as Exit from "@effect/io/Exit"
import * as Fiber from "@effect/io/Fiber"
import * as TestClock from "@effect/io/internal/testing/testClock"
import * as Queue from "@effect/io/Queue"
import * as Stream from "@effect/stream/Stream"
import { chunkCoordination } from "@effect/stream/test/utils/coordination"
import * as it from "@effect/stream/test/utils/extend"
import { assert, describe } from "vitest"

describe.concurrent("Stream", () => {
  it.effect("timeout - succeed", () =>
    Effect.gen(function*($) {
      const result = yield* $(
        Stream.succeed(1),
        Stream.timeout(Duration.infinity),
        Stream.runCollect
      )
      assert.deepStrictEqual(Array.from(result), [1])
    }))

  it.effect("timeout - should end the stream", () =>
    Effect.gen(function*($) {
      const result = yield* $(
        Stream.range(0, 5),
        Stream.tap(() => Effect.sleep(Duration.infinity)),
        Stream.timeout(Duration.zero),
        Stream.runCollect
      )
      assert.deepStrictEqual(Array.from(result), [])
    }))

  it.effect("timeoutFail - succeed", () =>
    Effect.gen(function*($) {
      const result = yield* $(
        Stream.range(0, 5),
        Stream.tap(() => Effect.sleep(Duration.infinity)),
        Stream.timeoutFail(() => false, Duration.zero),
        Stream.runDrain,
        Effect.map(() => true),
        Effect.either
      )
      assert.deepStrictEqual(result, Either.left(false))
    }))

  it.effect("timeoutFail - failures", () =>
    Effect.gen(function*($) {
      const result = yield* $(
        Stream.fail("original"),
        Stream.timeoutFail(() => "timeout", Duration.minutes(15)),
        Stream.runDrain,
        Effect.flip
      )
      assert.deepStrictEqual(result, "original")
    }))

  it.effect("timeoutFailCause", () =>
    Effect.gen(function*($) {
      const error = Cause.RuntimeException("boom")
      const result = yield* $(
        Stream.range(0, 5),
        Stream.tap(() => Effect.sleep(Duration.infinity)),
        Stream.timeoutFailCause(() => Cause.die(error), Duration.zero),
        Stream.runDrain,
        Effect.sandbox,
        Effect.either,
        Effect.map(Either.mapLeft(Cause.unannotate))
      )
      assert.deepStrictEqual(result, Either.left(Cause.die(error)))
    }))

  it.effect("timeoutTo - succeed", () =>
    Effect.gen(function*($) {
      const result = yield* $(
        Stream.range(0, 5),
        Stream.timeoutTo(Duration.infinity, Stream.succeed(-1)),
        Stream.runCollect
      )
      assert.deepStrictEqual(Array.from(result), [0, 1, 2, 3, 4])
    }))

  it.effect("timeoutTo - should switch streams", () =>
    Effect.gen(function*($) {
      const coordination = yield* $(chunkCoordination([
        Chunk.of(1),
        Chunk.of(2),
        Chunk.of(3)
      ]))
      const fiber = yield* $(
        Stream.fromQueue(coordination.queue),
        Stream.filterMapWhile(Exit.match({ onSuccess: Option.some, onFailure: Option.none })),
        Stream.flattenChunks,
        Stream.timeoutTo(Duration.seconds(2), Stream.succeed(4)),
        Stream.tap(() => coordination.proceed),
        Stream.runCollect,
        Effect.fork
      )
      yield* $(
        coordination.offer,
        Effect.zipRight(TestClock.adjust(Duration.seconds(1))),
        Effect.zipRight(coordination.awaitNext)
      )
      yield* $(
        coordination.offer,
        Effect.zipRight(TestClock.adjust(Duration.seconds(3))),
        Effect.zipRight(coordination.awaitNext)
      )
      yield* $(coordination.offer)
      const result = yield* $(Fiber.join(fiber))
      assert.deepStrictEqual(Array.from(result), [1, 2, 4])
    }))

  it.effect("timeoutTo - should not apply timeout after switch", () =>
    Effect.gen(function*($) {
      const queue1 = yield* $(Queue.unbounded<number>())
      const queue2 = yield* $(Queue.unbounded<number>())
      const stream1 = Stream.fromQueue(queue1)
      const stream2 = Stream.fromQueue(queue2)
      const fiber = yield* $(
        stream1,
        Stream.timeoutTo(Duration.seconds(2), stream2),
        Stream.runCollect,
        Effect.fork
      )
      yield* $(
        Queue.offer(queue1, 1),
        Effect.zipRight(TestClock.adjust(Duration.seconds(1)))
      )
      yield* $(
        Queue.offer(queue1, 2),
        Effect.zipRight(TestClock.adjust(Duration.seconds(3)))
      )
      yield* $(Queue.offer(queue1, 3))
      yield* $(
        Queue.offer(queue2, 4),
        Effect.zipRight(TestClock.adjust(Duration.seconds(3)))
      )
      yield* $(
        Queue.offer(queue2, 5),
        Effect.zipRight(Queue.shutdown(queue2))
      )
      const result = yield* $(Fiber.join(fiber))
      assert.deepStrictEqual(Array.from(result), [1, 2, 4, 5])
    }))
})
