 

#ifndef __FLAGS_H__
#define __FLAGS_H__

#include <bitset>

#include "cereal/types/bitset.hpp"

template <typename EnumClass, uint32_t NumberOfValues = static_cast<uint32_t>(EnumClass::COUNT) + 1>
class Flags
{
    static_assert(NumberOfValues > 0, "Number of possible Flags must be positive");

public:
    void setAll() { flags.set(); }
    void reset() { flags.reset(); }

    void setFlag(EnumClass flag) { flags.set(getIndex(flag)); }
    void unsetFlag(EnumClass flag) { flags.reset(getIndex(flag)); }
    bool isSet(EnumClass flag) const { return flags.test(getIndex(flag)); }
    bool isUnset(EnumClass flag) const { return !isSet(flag); }
    bool operator==(const Flags<EnumClass, NumberOfValues> &other) const { return flags == other.flags; };

    bool empty() const { return flags.none(); }

    template <class Archive>
    void serialize(Archive &ar, uint32_t) { ar(flags); }

private:
    uint32_t getIndex(const EnumClass &flag) const { return static_cast<uint32_t>(flag); }

    std::bitset<NumberOfValues> flags;
};

#endif // __FLAGS_H__
