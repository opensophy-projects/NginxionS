 

#ifndef __TIME_PRINT_H__
#define __TIME_PRINT_H__

#include <ostream>
#include <chrono>

static inline std::ostream &
operator<<(std::ostream &os, const std::chrono::microseconds &time)
{
    return os << time.count() << "usec";
}

static inline std::ostream &
operator<<(std::ostream &os, const std::chrono::milliseconds &time)
{
    return os << time.count() << "ms";
}

static inline std::ostream &
operator<<(std::ostream &os, const std::chrono::seconds &time)
{
    return os << time.count() << "s";
}

static inline std::ostream &
operator<<(std::ostream &os, const std::chrono::minutes &time)
{
    return os << time.count() << "m";
}

static inline std::ostream &
operator<<(std::ostream &os, const std::chrono::hours &time)
{
    return os << time.count() << "h";
}

#endif // __TIME_PRINT_H__
