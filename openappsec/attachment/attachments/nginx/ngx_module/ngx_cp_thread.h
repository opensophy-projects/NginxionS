 

/// @file ngx_cp_thread.h
#ifndef __NGX_CP_THREAD_H__
#define __NGX_CP_THREAD_H__

#include <stdbool.h>

typedef void *(*CpThreadRoutine)(void *); ///< Func

///
/// @brief Runs the provided routine with the provided arguments as a thread
/// @details Runs the provided routine as thread_func(args) in a thread. Depending on the inspection
/// mode runs it with a timeout.
/// This provided routine updates metrics if needed such as THREAD_TIMEOUT and THREAD_FAILURE.
/// @param[in, out] thread_func A pointer to the provided routine to run in a thread.
/// @param[in, out] arg Routine's arguments.
/// @param[in, out] timeout_msecs Called thread timeout.
/// @param[in, out] func_name The name of the provided routine.
/// @return int
///     - #0 Thread success.
///     - #1 Thread fail.
///
int ngx_cp_run_in_thread_timeout(CpThreadRoutine thread_func, void *arg, int timeout_msecs, char *);

#endif // __NGX_CP_THREAD_H__
