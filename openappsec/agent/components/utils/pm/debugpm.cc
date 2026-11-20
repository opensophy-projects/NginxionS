 

#include "debug.h"
#include <stdio.h>
#include <stdarg.h>
#include <stdlib.h>
#include <string.h>
#include <string>
#include <iostream>

using namespace std;

USE_DEBUG_FLAG(D_PM);

// Helper class for printing C format string
class CFmtPrinter
{
public:
    char buf[500];        // Length limit.
    explicit CFmtPrinter(const char *fmt, va_list va)
    {
        vsnprintf(buf, sizeof(buf), fmt, va);
        buf[sizeof(buf)-1] = '\0';
    }
};

static ostream &
operator<<(ostream &os, const CFmtPrinter &p)
{
    return os << p.buf;
}

void
panicCFmt(const string &func, uint line, const char *fmt, ...)
{
    va_list va;
    va_start(va, fmt);
    Debug("PM", func, line, true).getStreamAggr() << CFmtPrinter(fmt, va);
    va_end(va);
}

void
debugPrtCFmt(const char *func, uint line, const char *fmt, ...)
{
    va_list va;
    va_start(va, fmt);
    Debug("PM", func, line, Debug::DebugLevel::TRACE, D_PM).getStreamAggr() << CFmtPrinter(fmt, va);
    va_end(va);
}
