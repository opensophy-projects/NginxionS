 

#ifndef __HASH_COMBINE_H__
#define __HASH_COMBINE_H__

// Copied from Boost (hash_combine)
template <class T>
inline void hashCombine(size_t &seed, const T &v)
{
    std::hash<T> hasher;
    seed ^= hasher(v) + 0x9e3779b9 + (seed<<6) + (seed>>2);
}

#endif // __HASH_COMBINE_H__
