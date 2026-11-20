 

#ifndef __CACHE_TYPES_H__
#define __CACHE_TYPES_H__

#ifndef __CACHE_H__
#error cache_types.h should not be included directly!
#endif // __CACHE_H__

namespace Cache
{

using namespace std::chrono;

template <typename Value, typename Key>
class Holder
{
    using list_iterator = typename std::list<Key>::iterator;

public:
    Holder(I_TimeGet *timer) : time(timer!=nullptr?timer->getMonotonicTime():microseconds(0)) {}
    Holder(I_TimeGet *timer, const Value &_val)
            :
        time(timer!=nullptr?timer->getMonotonicTime():microseconds(0)),
        val(_val)
    {
    }

    Holder(I_TimeGet *timer, Value &&_val)
            :
        time(timer!=nullptr?timer->getMonotonicTime():microseconds(0)),
        val(std::move(_val))
    {
    }

    void setSelf(const list_iterator &iter) { self = iter; }
    list_iterator getSelf() const { return self; }

    void setNewTime(I_TimeGet *timer) { timer != nullptr ? time = timer->getMonotonicTime() : microseconds(0); }
    bool isExpired(const microseconds &expired) const { return time < expired; }
    Value & getValue() { return val; }
    const Value & getValue() const { return val; }
    microseconds getTime() { return time; }

private:
    microseconds time;
    Value val;
    list_iterator self;
};

template <typename Key>
class Holder<void, Key>
{
    using list_iterator = typename std::list<Key>::iterator;

public:
    Holder(I_TimeGet *timer) : time(timer!=nullptr?timer->getMonotonicTime():microseconds(0)) {}

    void setNewTime(I_TimeGet *timer) { timer != nullptr ? time = timer->getMonotonicTime() : microseconds(0); }
    bool isExpired(const microseconds &expired) const { return time < expired; }
    microseconds getTime() { return time; }

    void setSelf(const list_iterator &iter) { self = iter; }
    list_iterator getSelf() const { return self; }

private:
    microseconds time;
    list_iterator self;
};

} // namespace Cache

#endif // __CACHE_TYPES_H__
