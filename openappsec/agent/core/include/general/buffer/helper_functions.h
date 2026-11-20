 

#ifndef __BUFFER_HELPER_FUNCTIONS_H__
#define __BUFFER_HELPER_FUNCTIONS_H__

// Function to allow comparison with types that have data (of types char or u_char) and size
template <typename T>
bool
operator==(const Buffer &buf, const T &t)
{
    return buf.isEqual(t.data(), t.size());
}

template <typename T>
bool
operator==(const T &t, const Buffer &buf)
{
    return buf.isEqual(t.data(), t.size());
}

template <typename T>
bool
operator!=(const Buffer &buf, const T &t)
{
    return !buf.isEqual(t.data(), t.size());
}

template <typename T>
bool
operator!=(const T &t, const Buffer &buf)
{
    return !buf.isEqual(t.data(), t.size());
}

#endif // __BUFFER_HELPER_FUNCTIONS_H__
