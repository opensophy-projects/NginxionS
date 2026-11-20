 

#ifndef __DEBUGPM_H__
#define __DEBUGPM_H__

#include <iostream>
#include <string>

#include "debug.h"

// Assertions

// C-style BC functions (e.g. for PM).
void debugPrtCFmt(const std::string &func, uint line, const char *fmt, ...) __attribute__((format (printf, 3, 4)));
#define debugCFmt(flag, fmt, ...)                                \
    if (!Debug::isDebugSet(flag))                                \
    {                                                            \
    } else                                                       \
        debugPrtCFmt(__FUNCTION__, __LINE__, fmt, ##__VA_ARGS__)

void panicCFmt(const std::string &func, uint line, const char *fmt, ...) __attribute__((format (printf, 3, 4)));
#define assertCondCFmt(cond, fmt, ...)                         \
    if (CP_LIKELY(cond))                                       \
    {                                                          \
    } else                                                     \
        panicCFmt(__FUNCTION__, __LINE__, fmt, ##__VA_ARGS__)

#endif // __DEBUGPM_H__
