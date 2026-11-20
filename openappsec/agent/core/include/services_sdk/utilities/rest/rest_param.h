 

#ifndef __REST_PARAM_H__
#define __REST_PARAM_H__

template <typename T>
class RestParam
{
public:
    RestParam() : is_active(false) {}
    RestParam(const T &_val) : is_active(true), val(_val) {}

    bool isActive() const { return is_active; }

    void setActive(bool new_active) { is_active = new_active; }

    operator T &()
    {
        dbgAssert(is_active) << AlertInfo(AlertTeam::CORE, "rest i/s") << "Tried to access a non-existing variable";
        return val;
    }

    operator const T &() const
    {
        dbgAssert(is_active) << AlertInfo(AlertTeam::CORE, "rest i/s") << "Tried to access a non-existing variable";
        return val;
    }

    T & get() { return val; }

    const T & get() const { return val; }

    T &
    operator=(const T &_val)
    {
        is_active = true;
        val = _val;
        return val;
    }

    T &
    operator=(T &&_val)
    {
        is_active = true;
        val = std::move(_val);
        return val;
    }

private:
    bool is_active;
    T val;
};

#endif // __REST_PARAM_H__
