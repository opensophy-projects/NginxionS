 

#include "buffer.h"

Buffer::DataContainer::DataContainer(std::vector<u_char> &&_vec)
        :
    vec(std::move(_vec)),
    ptr(vec.data()),
    len(vec.size())
{
}

Buffer::DataContainer::DataContainer(const u_char *_ptr, uint _len, MemoryType _type)
        :
    len(_len)
{
    if (_type == MemoryType::OWNED) {
        vec = std::vector<u_char>(_ptr, _ptr + len);
        ptr = vec.data();
    } else {
        ptr = _ptr;
        is_owned = false;
    }
}
