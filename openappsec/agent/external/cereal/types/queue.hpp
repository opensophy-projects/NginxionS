/*! \file queue.hpp
    \brief Support for types found in \<queue\>
    \ingroup STLSupport */

#ifndef CEREAL_TYPES_QUEUE_HPP_
#define CEREAL_TYPES_QUEUE_HPP_

#include <cereal/details/helpers.hpp>
#include <queue>

// The default container for queue is deque, so let's include that too
#include <cereal/types/deque.hpp>
// The default comparator for queue is less
#include <cereal/types/functional.hpp>

namespace cereal
{
  namespace queue_detail
  {
    //! Allows access to the protected container in queue
    /*! @internal */
    template <class T, class C> inline
    C const & container( std::queue<T, C> const & queue )
    {
      struct H : public std::queue<T, C>
      {
        static C const & get( std::queue<T, C> const & q )
        {
          return q.*(&H::c);
        }
      };

      return H::get( queue );
    }

    //! Allows access to the protected container in priority queue
    /*! @internal */
    template <class T, class C, class Comp> inline
    C const & container( std::priority_queue<T, C, Comp> const & priority_queue )
    {
      struct H : public std::priority_queue<T, C, Comp>
      {
        static C const & get( std::priority_queue<T, C, Comp> const & pq )
        {
          return pq.*(&H::c);
        }
      };

      return H::get( priority_queue );
    }

    //! Allows access to the protected comparator in priority queue
    /*! @internal */
    template <class T, class C, class Comp> inline
    Comp const & comparator( std::priority_queue<T, C, Comp> const & priority_queue )
    {
      struct H : public std::priority_queue<T, C, Comp>
      {
        static Comp const & get( std::priority_queue<T, C, Comp> const & pq )
        {
          return pq.*(&H::comp);
        }
      };

      return H::get( priority_queue );
    }
  }

  //! Saving for std::queue
  template <class Archive, class T, class C> inline
  void CEREAL_SAVE_FUNCTION_NAME( Archive & ar, std::queue<T, C> const & queue )
  {
    ar( CEREAL_NVP_("container", queue_detail::container( queue )) );
  }

  //! Loading for std::queue
  template <class Archive, class T, class C> inline
  void CEREAL_LOAD_FUNCTION_NAME( Archive & ar, std::queue<T, C> & queue )
  {
    C container;
    ar( CEREAL_NVP_("container", container) );
    queue = std::queue<T, C>( std::move( container ) );
  }

  //! Saving for std::priority_queue
  template <class Archive, class T, class C, class Comp> inline
  void CEREAL_SAVE_FUNCTION_NAME( Archive & ar, std::priority_queue<T, C, Comp> const & priority_queue )
  {
    ar( CEREAL_NVP_("comparator", queue_detail::comparator( priority_queue )) );
    ar( CEREAL_NVP_("container", queue_detail::container( priority_queue )) );
  }

  //! Loading for std::priority_queue
  template <class Archive, class T, class C, class Comp> inline
  void CEREAL_LOAD_FUNCTION_NAME( Archive & ar, std::priority_queue<T, C, Comp> & priority_queue )
  {
    Comp comparator;
    ar( CEREAL_NVP_("comparator", comparator) );

    C container;
    ar( CEREAL_NVP_("container", container) );

    priority_queue = std::priority_queue<T, C, Comp>( comparator, std::move( container ) );
  }
} // namespace cereal

#endif // CEREAL_TYPES_QUEUE_HPP_
