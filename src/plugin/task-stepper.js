import { pause } from '../util/async'

/**
  A {Stepper} is responsible for iterating through the generator function.
*  It iterates through each yield, while being mindful of the tis state.
*  As long as the ti is not `Canceled` or `Rejected`, it continues to iterate
*  until the ti is `Resolved`.
*
*  @returns {TaskInstance} after operation has finished running
*  @constructs Task Stepper
*/
export default function createTaskStepper(ti, subscriber, provider) {
  let iter = ti.operation() // start generator

  return {
    async handleStart() {
      await subscriber.asyncBeforeStart(ti)
      ti.hasStarted = true
      ti._updateComputed()
      return ti
    },

    async handleYield(prev) {
      await subscriber.asyncBeforeYield(ti)
      let output = iter.next(prev)
      return output
    },

    handleSuccess(val) {
      ti.isResolved = true
      ti.value = val
      ti._updateComputed()
      subscriber.onSuccess(ti)
      subscriber.afterEnd(ti)
      return ti
    },

    handleError(err) {
      ti.isRejected = true
      ti.error = err
      ti._updateComputed()
      subscriber.onError(ti)
      subscriber.afterEnd(ti)
      return ti
    },

    /**
     * Task Instances are canceled from the outside,
     * so the cancelation and handeling are done seperately.
     */
    triggerCancel() {
      if (ti.isOver) return ti
      ti.isCanceled = true
      ti._updateComputed()
      return ti
    },
    handleCancel(val) {
      iter.return() // cause iter to terminate; still runs finally clause
      provider.cleanup(val)
      if (ti.isDropped) subscriber.onDrop(ti)
      else if (ti.isRestarted) subscriber.onRestart(ti)
      subscriber.onCancel(ti)
      subscriber.afterEnd(ti)
      return ti
    },

    /**
     * At each step, checks the state of the task instance to know appropriate
     * action and recursively iterates through generator function until
     * operation is either canceled, rejected, or resolved.
     */
    async stepThrough(gen) {
      let stepper = this

      async function takeAStep(prev = undefined) {
        let value, done

        if (ti._delayStart > 0) await pause(ti._delayStart)     // DELAYED TODO

        if (ti.isCanceled) return stepper.handleCancel(value)   // CANCELED / PRE-START

        if (!ti.hasStarted) await stepper.handleStart()         // STARTED

        if (ti.isCanceled) return stepper.handleCancel(value)   // CANCELED / POST-START

        try {
          ({ value, done } = await stepper.handleYield(prev))
        }
        catch (err) {                                           // REJECTED
          // TODO better error handling
          return stepper.handleError(err)
        }

        if (ti.isCanceled) return stepper.handleCancel(value)   // CANCELED / POST-ITER

        value = await value
        if (done) return stepper.handleSuccess(value)           // RESOLVED
        else return takeAStep(value)
      }

      return takeAStep()
    }
  }
}
