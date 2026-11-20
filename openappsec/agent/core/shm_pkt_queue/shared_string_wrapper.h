 

#ifndef __SHARED_STRING_WRAPPER_H__
#define __SHARED_STRING_WRAPPER_H__

#include <boost/lockfree/spsc_queue.hpp>
#include <boost/interprocess/managed_shared_memory.hpp>
#include <boost/interprocess/allocators/allocator.hpp>
#include <boost/interprocess/containers/string.hpp>

using char_alloc = boost::interprocess::allocator<u_char, boost::interprocess::managed_shared_memory::segment_manager>;
using shared_string = boost::interprocess::basic_string<u_char, std::char_traits<u_char>, char_alloc>;

class SharedStringWrapper
{
public:
    static void setAlloc(boost::interprocess::managed_shared_memory::segment_manager *_alloc) { alloc = _alloc; }

    SharedStringWrapper() : str(alloc) {}

    void reserve(size_t size) { str.reserve(size); }
    void append(const u_char *data, size_t len) { str.append(data, len); }
    size_t size() const { return str.size(); }
    shared_string::iterator begin() { return str.begin(); }
    shared_string::iterator end() { return str.end(); }
    u_char * data() { return str.data(); }

private:
    static boost::interprocess::managed_shared_memory::segment_manager *alloc;
    shared_string str;
};

using ring_buffer = boost::lockfree::spsc_queue<SharedStringWrapper, boost::lockfree::capacity<200>>;

#endif // __SHARED_STRING_WRAPPER_H__
