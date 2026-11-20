/*! \file static_object.hpp
    \brief Internal polymorphism static object support
    \ingroup Internal */

*/
#ifndef CEREAL_DETAILS_STATIC_OBJECT_HPP_
#define CEREAL_DETAILS_STATIC_OBJECT_HPP_

#include <cereal/macros.hpp>

#if CEREAL_THREAD_SAFE
#include <mutex>
#endif
#ifdef _MSC_VER
#   define CEREAL_DLL_EXPORT __declspec(dllexport)
#   define CEREAL_USED
#else // clang or gcc
#   define CEREAL_DLL_EXPORT
#   define CEREAL_USED __attribute__ ((__used__))
#endif

namespace cereal
{
  namespace detail
  {
    //! A static, pre-execution object
    /*! This class will create a single copy (singleton) of some
        type and ensures that merely referencing this type will
        cause it to be instantiated and initialized pre-execution.
        For example, this is used heavily in the polymorphic pointer
        serialization mechanisms to bind various archive types with
        different polymorphic classes */
    template <class T>
    class CEREAL_DLL_EXPORT StaticObject
    {
      private:
        //! Forces instantiation at pre-execution time
        static void instantiate( T const & ) {}

        static T & create()
        {
          static T t;
          instantiate(instance);
          return t;
        }

        StaticObject( StaticObject const & /*other*/ ) {}

      public:
        static T & getInstance()
        {
          return create();
        }

        //! A class that acts like std::lock_guard
        class LockGuard
        {
          #if CEREAL_THREAD_SAFE
          public:
            LockGuard(std::mutex & m) : lock(m) {}
          private:
            std::unique_lock<std::mutex> lock;
          #else
          public:
            ~LockGuard() CEREAL_NOEXCEPT {} // prevents variable not used
          #endif
        };

        //! Attempts to lock this static object for the current scope
        /*! @note This function is a no-op if cereal is not compiled with
                  thread safety enabled (CEREAL_THREAD_SAFE = 1).

            This function returns an object that holds a lock for
            this StaticObject that will release its lock upon destruction. This
            call will block until the lock is available. */
        static LockGuard lock()
        {
          #if CEREAL_THREAD_SAFE
          return LockGuard{instanceMutex};
          #else
          return LockGuard{};
          #endif
        }

      private:
        static T & instance;
        #if CEREAL_THREAD_SAFE
        static std::mutex instanceMutex;
        #endif
    };

    template <class T> T & StaticObject<T>::instance = StaticObject<T>::create();
    #if CEREAL_THREAD_SAFE
    template <class T> std::mutex StaticObject<T>::instanceMutex;
    #endif
  } // namespace detail
} // namespace cereal

#endif // CEREAL_DETAILS_STATIC_OBJECT_HPP_
