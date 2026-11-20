 

#ifndef __TOSTRING_H__
#define __TOSTRING_H__

#include <sstream>

class ToString
{
public:
    ToString() {}

    template<typename T, typename... Args>
    ToString(const T &obj, Args... args)
    {
        str << obj << static_cast<std::string>(ToString(std::forward<Args>(args)...));
    }

    template<typename T>
    ToString &
    operator<<(const T &obj)
    {
        str << obj;
        return *this;
    }

    template<typename T>
    bool
    operator==(const T &obj) const
    {
        return *this == ToString(obj);
    }

    template<typename T>
    bool
    operator!=(const T &obj) const
    {
        return *this != ToString(obj);
    }

    bool
    operator==(const ToString &other) const
    {
        return str.str() == other.str.str();
    }

    bool
    operator!=(const ToString &other) const
    {
        return str.str() != other.str.str();
    }

    void reset() { str.str(""); }

    operator std::string() { return str.str(); }

private:
    std::ostringstream str;
};

#endif // __TOSTRING_H__
